"""Ashrium VFR GPU pipeline: SAM 2 + SAM 3D Body init + two-view MHR + Newton + GarmentCode.

Host-agnostic. Modal loads this from @enter; there is no Cog BasePredictor.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch
from PIL import Image

from body.diagnostics import StageClock, elapsed_ms, merge_fit_diagnostics
from body.initializer import Sam3dAccessError, load_sam3d_estimator, initialize_view
from body.mhr_fit import fit_two_view_mhr
from body.silhouettes import load_sam2_predictor, segment_person
from body.topology import MHR_TOPOLOGY_VERSION
from cuda_gate import torch_work
from progress import StageReporter


def _read_rgb(path: Path, max_side: int = 640) -> np.ndarray:
    image = Image.open(str(path)).convert("RGB")
    width, height = image.size
    longest = max(width, height)
    if longest > max_side:
        scale = max_side / float(longest)
        image = image.resize(
            (max(1, int(width * scale)), max(1, int(height * scale))),
            Image.Resampling.BILINEAR,
        )
    return np.asarray(image, dtype=np.uint8)


def _parse_json(value: str, label: str) -> Any:
    if not value or not str(value).strip():
        raise RuntimeError(f"{label} is required for task=drape.")
    try:
        return json.loads(value)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"{label} is not valid JSON: {error}") from error


class AshriumPipeline:
    def setup(self) -> None:
        package_root = os.path.dirname(os.path.abspath(__file__))
        if package_root not in sys.path:
            sys.path.insert(0, package_root)

        if not torch.cuda.is_available():
            raise RuntimeError("Ashrium GPU pipeline requires a CUDA GPU (A100-80GB).")

        self.device = torch.device("cuda")
        os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
        # @modal.concurrent runs two shoppers per container on threads. Models
        # holding per-call state are serialized; the MHR fit itself overlaps.
        self._sam2_lock = threading.Lock()
        self._sam3d_lock = threading.Lock()
        self._drape_lock = threading.Lock()
        from body.prefetch_weights import configure_hf_cache, sam3d_snapshot_ready

        configure_hf_cache()
        baked = sam3d_snapshot_ready()
        print(
            "Ashrium GPU setup starting "
            f"(sam3d_volume={'yes' if baked else 'no'}).",
            flush=True,
        )
        self.setup_ms = 0.0
        setup_started = time.perf_counter()
        try:
            self.estimator, self.mhr = load_sam3d_estimator(self.device)
            self.sam2 = load_sam2_predictor(self.device)
        except Sam3dAccessError:
            raise
        except Exception as error:
            raise RuntimeError(f"GPU setup failed on live weights: {error}") from error

        self.setup_ms = elapsed_ms(setup_started)
        # Compile the cloth kernels now, off the shopper's clock: the first drape
        # in a new container otherwise spends ~18 s compiling. Holds the drape
        # lock, so a drape that arrives early waits for it instead of racing it.
        threading.Thread(target=self._warm_up_drape, name="drape-warm-up", daemon=True).start()

    def _warm_up_drape(self) -> None:
        try:
            with self._drape_lock:
                from drape.newton_style3d import warm_up

                print(f"Drape warm-up: {warm_up()}", flush=True)
        except Exception as error:  # a failed warm-up only means the first drape compiles
            print(f"Drape warm-up failed: {type(error).__name__}: {error}", flush=True)

    def predict_body(self, *args: Any, **kwargs: Any) -> dict:
        # Never overlaps a Warp CUDA-graph capture (cuda_gate.py).
        with torch_work():
            return self._predict_body(*args, **kwargs)

    def _predict_body(
        self,
        front_image: Path,
        side_image: Path,
        height_cm: float,
        sex: str,
        weight_kg: float,
        on_stage: StageReporter | None = None,
    ) -> dict:
        report = on_stage or (lambda _stage: None)
        if float(height_cm) < 50:
            raise RuntimeError("task=body requires height_cm between 50 and 250.")

        front_rgb = _read_rgb(front_image)
        side_rgb = _read_rgb(side_image)

        clock = StageClock()
        clock.set("setup", getattr(self, "setup_ms", 0.0))
        report("silhouettes")
        # SAM 2 / SAM 3D Body predictors hold per-image state: one shopper at a time.
        with self._sam2_lock:
            with clock.measure("sam2_front"):
                front_mask, front_bbox = segment_person(self.sam2, front_rgb)
            with clock.measure("sam2_side"):
                side_mask, side_bbox = segment_person(self.sam2, side_rgb)

        report("body")
        with self._sam3d_lock:
            with clock.measure("sam3d_front"):
                front_init = initialize_view(self.estimator, front_rgb, front_mask, front_bbox)
            with clock.measure("sam3d_side"):
                side_init = initialize_view(self.estimator, side_rgb, side_mask, side_bbox)

        with clock.measure("mhr_fit"):
            result = fit_two_view_mhr(
                mhr=self.mhr,
                front=front_init,
                side=side_init,
                front_mask=front_mask,
                side_mask=side_mask,
                height_cm=float(height_cm),
                weight_kg=None if weight_kg is None or float(weight_kg) <= 0 else float(weight_kg),
                device=self.device,
                on_measure=lambda: report("measure"),
            )

        diagnostics = result.get("fit_diagnostics")
        timings = diagnostics.get("stage_timings_ms") if isinstance(diagnostics, dict) else None
        # Stages timed inside mhr_fit are reported on their own, not twice.
        for stage in ("photo_uv", "serialization"):
            stage_ms = timings.get(stage) if isinstance(timings, dict) else None
            if isinstance(stage_ms, (int, float)) and stage_ms > 0:
                clock.subtract("mhr_fit", float(stage_ms))
                clock.set(stage, float(stage_ms))

        merge_fit_diagnostics(result, stage_timings_ms=clock.as_dict())
        result["task"] = "body"
        result["topology_version"] = MHR_TOPOLOGY_VERSION
        result["sex"] = sex
        result["stated_height_cm"] = float(height_cm)
        return result

    def predict_drape(self, **kwargs: Any) -> dict:
        # Newton / Warp thread safety is unverified: one drape per container at a time.
        with self._drape_lock:
            return self._predict_drape(**kwargs)

    def _predict_drape(
        self,
        body_positions: str,
        garment_mesh: str,
        body_girths: str,
        tensile_stiffness: float,
        bending_rigidity: float,
        shear_stiffness: float,
        area_density: float,
    ) -> dict:
        """One size of a sewn garment on the shopper's fitted body (drape/sewn.py)."""
        from body.girths import torso_landmarks_cm
        from body.photo_uv import mhr_lod1_faces
        from body.topology import MHR_VERTEX_COUNT
        from drape.sewn import body_collider, drape_sewn_size, sim_output, too_small

        started = time.perf_counter()
        body_cm = np.asarray(_parse_json(body_positions, "body_positions"), dtype=np.float64).reshape(-1, 3)
        if body_cm.shape[0] != MHR_VERTEX_COUNT or not np.isfinite(body_cm).all():
            raise RuntimeError(f"body_positions must be the {MHR_VERTEX_COUNT}-vertex MHR LOD 1 body in cm.")
        mesh = _parse_json(garment_mesh, "garment_mesh")
        if not isinstance(mesh, dict) or mesh.get("schema") != "ashrium.garment_mesh.v1":
            raise RuntimeError("garment_mesh must be an ashrium.garment_mesh.v1 sewn garment (re-ingest the SKU).")
        category = str(mesh.get("category") or "")
        if category not in ("tee", "pant", "dress", "outerwear"):
            raise RuntimeError("garment_mesh has no category (re-ingest the SKU).")
        reason = too_small(
            category,
            mesh.get("pattern_girths") or {},
            _parse_json(body_girths, "body_girths"),
            bool(mesh.get("elastic_waist")),
        )
        if reason:
            return {"task": "drape", "status": "too_small", "reason": reason, "topology_version": MHR_TOPOLOGY_VERSION}

        faces = mhr_lod1_faces()
        body_m = body_cm / 100.0
        landmarks = torso_landmarks_cm(body_cm)
        if category == "pant" and landmarks is None:
            raise RuntimeError("No waist found on the fitted body; cannot place bottoms.")
        collider_positions, collider_faces, _inflate = body_collider(body_m, faces)
        result = drape_sewn_size(
            mesh,
            category,
            body_m,
            faces,
            (collider_positions, collider_faces),
            {
                "tensile_stiffness": float(tensile_stiffness),
                "bending_rigidity": float(bending_rigidity),
                "shear_stiffness": float(shear_stiffness),
                "area_density": float(area_density),
            },
            waist_y=None if landmarks is None else landmarks["waist_y"] / 100.0,
        )
        out = sim_output(result, mesh)
        out["task"] = "drape"
        out["topology_version"] = MHR_TOPOLOGY_VERSION
        out["timings_ms"] = {**out["timings_ms"], "request_ms": elapsed_ms(started)}
        return out
