"""Ashrium VFR GPU pipeline: SAM 2 + SAM 3D Body init + two-view MHR + Newton + GarmentCode.

Host-agnostic. Modal loads this from @enter; there is no Cog BasePredictor.
"""

from __future__ import annotations

import json
import os
import sys
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

        from pattern.paths import garmentcode_root

        self.garmentcode_root = garmentcode_root()
        self.setup_ms = elapsed_ms(setup_started)

    def predict_body(
        self,
        front_image: Path,
        side_image: Path,
        height_cm: float,
        sex: str,
        weight_kg: float,
    ) -> dict:
        if float(height_cm) < 50:
            raise RuntimeError("task=body requires height_cm between 50 and 250.")

        front_rgb = _read_rgb(front_image)
        side_rgb = _read_rgb(side_image)

        clock = StageClock()
        clock.set("setup", getattr(self, "setup_ms", 0.0))
        with clock.measure("sam2_front"):
            front_mask, front_bbox = segment_person(self.sam2, front_rgb)
        with clock.measure("sam2_side"):
            side_mask, side_bbox = segment_person(self.sam2, side_rgb)

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
            )

        diagnostics = result.get("fit_diagnostics")
        serialization_ms = 0.0
        if isinstance(diagnostics, dict):
            timings = diagnostics.get("stage_timings_ms")
            if isinstance(timings, dict) and isinstance(timings.get("serialization"), (int, float)):
                serialization_ms = float(timings["serialization"])
        if serialization_ms > 0:
            clock.subtract("mhr_fit", serialization_ms)
            clock.set("serialization", serialization_ms)

        merge_fit_diagnostics(result, stage_timings_ms=clock.as_dict())
        result["task"] = "body"
        result["topology_version"] = MHR_TOPOLOGY_VERSION
        result["sex"] = sex
        result["stated_height_cm"] = float(height_cm)
        return result

    def predict_drape(
        self,
        collider_positions: str,
        collider_indices: str,
        garment_rest_mesh: str,
        tensile_stiffness: float,
        bending_rigidity: float,
        shear_stiffness: float,
        area_density: float,
        origin_y: float,
    ) -> dict:
        from drape.collider import downsample_to_lod3, parse_collider_mesh
        from drape.garment import build_cloth_from_rest_mesh, parse_rest_length_mesh
        from drape.newton_xpbd import drape_newton_xpbd

        positions, indices = parse_collider_mesh(
            _parse_json(collider_positions, "collider_positions"),
            _parse_json(collider_indices, "collider_indices"),
        )
        collider_verts, collider_faces = downsample_to_lod3(positions, indices)
        rest = parse_rest_length_mesh(_parse_json(garment_rest_mesh, "garment_rest_mesh"))
        cloth_rest, cloth_indices, pin_mask = build_cloth_from_rest_mesh(rest, float(origin_y))
        draped = drape_newton_xpbd(
            cloth_rest=cloth_rest,
            cloth_indices=cloth_indices,
            pin_mask=pin_mask,
            collider_positions=collider_verts,
            collider_indices=collider_faces,
            mechanical={
                "tensile_stiffness": float(tensile_stiffness),
                "bending_rigidity": float(bending_rigidity),
                "shear_stiffness": float(shear_stiffness),
                "area_density": float(area_density),
            },
        )
        draped["task"] = "drape"
        draped["topology_version"] = MHR_TOPOLOGY_VERSION
        return draped

    def predict_pattern(
        self,
        product_text: str,
        size_chart: str,
        garment_category: str,
    ) -> dict:
        from pattern.instantiate import instantiate_patterns

        text = product_text if isinstance(product_text, str) else ""
        if len(text) > 16_000:
            text = text[:16_000]
        result = instantiate_patterns(
            category=garment_category,
            product_text=text,
            size_chart_json=size_chart,
        )
        result["task"] = "pattern"
        result["topology_version"] = MHR_TOPOLOGY_VERSION
        return result
