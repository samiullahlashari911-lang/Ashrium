"""Ashrium VFR Cog: SAM 2 + SAM 3D Body initializer + two-view MHR (task=body)."""

from __future__ import annotations

import os
import sys

import numpy as np
import torch
from cog import BasePredictor, Input, Path
from PIL import Image

from body.initializer import Sam3dAccessError, load_sam3d_estimator, initialize_view
from body.mhr_fit import fit_two_view_mhr, load_mhr_script
from body.silhouettes import load_sam2_predictor, segment_person
from body.topology import MHR_TOPOLOGY_VERSION


def _read_rgb(path: Path) -> np.ndarray:
    image = Image.open(str(path)).convert("RGB")
    return np.asarray(image, dtype=np.uint8)


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

    def predict(
        self,
        task: str = Input(
            description="Cog task. Phase 2 implements body. drape/pattern fail closed until later phases.",
            default="body",
            choices=["body", "drape", "pattern"],
        ),
        front_image: Path = Input(description="Head-cropped front A-pose WebP/PNG/JPEG."),
        side_image: Path = Input(description="Head-cropped side profile WebP/PNG/JPEG."),
        height_cm: float = Input(description="Stated height in centimetres.", ge=50, le=250),
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
    ) -> dict:
        if task == "drape":
            raise RuntimeError("task=drape is not in this Cog version. It lands in Phase 4 (Newton XPBD).")
        if task == "pattern":
            raise RuntimeError("task=pattern is not in this Cog version. It lands in Phase 5 (GarmentCode).")
        if task != "body":
            raise RuntimeError(f"Unknown task={task}.")

        front_rgb = _read_rgb(front_image)
        side_rgb = _read_rgb(side_image)

        front_mask, front_bbox = segment_person(self.sam2, front_rgb)
        side_mask, side_bbox = segment_person(self.sam2, side_rgb)
        torch.cuda.empty_cache()

        front_init = initialize_view(self.estimator, front_rgb, front_mask, front_bbox)
        side_init = initialize_view(self.estimator, side_rgb, side_mask, side_bbox)
        torch.cuda.empty_cache()

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
