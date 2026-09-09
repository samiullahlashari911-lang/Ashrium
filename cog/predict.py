"""Ashrium VFR Cog: SAM 2 + SAM 3D Body initializer + two-view MHR + Newton drape + GarmentCode pattern."""

from __future__ import annotations

import json
import os
import sys
from typing import Any

import numpy as np
import torch
from cog import BasePredictor, Input, Path
from PIL import Image

from body.initializer import Sam3dAccessError, load_sam3d_estimator, initialize_view
from body.mhr_fit import fit_two_view_mhr, load_mhr_script
from body.silhouettes import load_sam2_predictor, segment_person
from body.topology import MHR_TOPOLOGY_VERSION
from drape.collider import downsample_to_lod3, parse_collider_mesh
from drape.garment import build_cloth_from_rest_mesh, parse_rest_length_mesh
from drape.newton_xpbd import drape_newton_xpbd
from pattern.paths import garmentcode_root


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


class Predictor(BasePredictor):
    def setup(self) -> None:
        package_root = os.path.dirname(os.path.abspath(__file__))
        if package_root not in sys.path:
            sys.path.insert(0, package_root)

        if not torch.cuda.is_available():
            raise RuntimeError("This Cog requires a CUDA GPU (gpu-a100-large).")

        self.device = torch.device("cuda")
        os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
        try:
            self.estimator, mhr_path = load_sam3d_estimator(self.device)
            self.mhr = load_mhr_script(mhr_path, self.device)
            self.sam2 = load_sam2_predictor(self.device)
        except Sam3dAccessError:
            raise
        except Exception as error:
            raise RuntimeError(f"Cog setup failed on live weights: {error}") from error

        # Cheap path check so task=pattern cannot silently miss GarmentCode MIT assets.
        self.garmentcode_root = garmentcode_root()

    def predict(
        self,
        task: str = Input(
            description="Cog task. body = MHR avatar. drape = Newton XPBD. pattern = GarmentCode 2D ingest.",
            default="body",
            choices=["body", "drape", "pattern"],
        ),
        front_image: Path = Input(
            description="Head-cropped front A-pose WebP/PNG/JPEG. Required for task=body.",
            default=None,
        ),
        side_image: Path = Input(
            description="Head-cropped side profile WebP/PNG/JPEG. Required for task=body.",
            default=None,
        ),
        height_cm: float = Input(
            description="Stated height in centimetres. Required for task=body.",
            default=0,
            ge=0,
            le=250,
        ),
        sex: str = Input(
            description="Capture sex. Used as metadata; girths come from the MHR mesh.",
            default="unspecified",
            choices=["female", "male", "unspecified"],
        ),
        weight_kg: float = Input(
            description="Optional stated weight in kilograms. Omit or set 0 if unknown.",
            default=0,
            ge=0,
            le=400,
        ),
        collider_positions: str = Input(
            description="JSON float xyz metres for the rigid collider (LOD 1 or LOD 3).",
            default="",
        ),
        collider_indices: str = Input(
            description="JSON int triangle indices for the rigid collider.",
            default="",
        ),
        garment_rest_mesh: str = Input(
            description="JSON ashrium.rest_length.v1 panel used to build the cloth mesh.",
            default="",
        ),
        tensile_stiffness: float = Input(
            description="KES tensile stiffness (N/m). Drape look only; does not flip size.",
            default=75,
            ge=0,
        ),
        bending_rigidity: float = Input(
            description="KES bending rigidity (N*m). Drape look only.",
            default=0.03,
            ge=0,
        ),
        shear_stiffness: float = Input(
            description="KES shear stiffness (N/m). Drape look only.",
            default=45,
            ge=0,
        ),
        area_density: float = Input(
            description="Fabric area density (kg/m^2).",
            default=0.18,
            ge=0,
        ),
        origin_y: float = Input(
            description="Cloth vertical origin in metres (Y-up).",
            default=0,
        ),
        product_text: str = Input(
            description="Product title, tags, and description for HTML-style parse. task=pattern.",
            default="",
        ),
        size_chart: str = Input(
            description="JSON array of {sizeCode, chestCm, waistCm, hipCm, lengthCm}. task=pattern.",
            default="",
        ),
        garment_category: str = Input(
            description="Garment category for task=pattern: tee, pant, dress, outerwear, other.",
            default="tee",
            choices=["tee", "pant", "dress", "outerwear", "other"],
        ),
    ) -> dict:
        if task == "pattern":
            return self._predict_pattern(
                product_text=product_text,
                size_chart=size_chart,
                garment_category=garment_category,
            )
        if task == "drape":
            return self._predict_drape(
                collider_positions=collider_positions,
                collider_indices=collider_indices,
                garment_rest_mesh=garment_rest_mesh,
                tensile_stiffness=tensile_stiffness,
                bending_rigidity=bending_rigidity,
                shear_stiffness=shear_stiffness,
                area_density=area_density,
                origin_y=origin_y,
            )
        if task != "body":
            raise RuntimeError(f"Unknown task={task}.")
        return self._predict_body(
            front_image=front_image,
            side_image=side_image,
            height_cm=height_cm,
            sex=sex,
            weight_kg=weight_kg,
        )

    def _predict_body(
        self,
        front_image: Path | None,
        side_image: Path | None,
        height_cm: float,
        sex: str,
        weight_kg: float,
    ) -> dict:
        if front_image is None or side_image is None:
            raise RuntimeError("task=body requires front_image and side_image.")
        if float(height_cm) < 50:
            raise RuntimeError("task=body requires height_cm between 50 and 250.")

        front_rgb = _read_rgb(front_image)
        side_rgb = _read_rgb(side_image)

        front_mask, front_bbox = segment_person(self.sam2, front_rgb)
        side_mask, side_bbox = segment_person(self.sam2, side_rgb)

        front_init = initialize_view(self.estimator, front_rgb, front_mask, front_bbox)
        side_init = initialize_view(self.estimator, side_rgb, side_mask, side_bbox)

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
        result["task"] = "body"
        result["topology_version"] = MHR_TOPOLOGY_VERSION
        result["sex"] = sex
        result["stated_height_cm"] = float(height_cm)
        return result

    def _predict_drape(
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

    def _predict_pattern(
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
