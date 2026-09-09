"""SAM 3D Body per-view initializer (SAM License on this step only). Never stubbed.

Loads the live estimator the same way Meta documents:

    from notebook.utils import setup_sam_3d_body
    estimator = setup_sam_3d_body(hf_repo_id="facebook/sam-3d-body-dinov3")
    outputs = estimator.process_one_image(rgb_image)

We still prompt with our Apache SAM 2 silhouette (bbox + mask). That is the
locked Cog pipeline — not a replacement for `setup_sam_3d_body`. Demo
visualization (`visualize_sample_together`) is not part of the product output.
"""

from __future__ import annotations

import os
import sys
from typing import Any

import numpy as np

from .topology import SAM3D_HF_REPO


class Sam3dAccessError(RuntimeError):
    """Raised when gated SAM 3D Body weights cannot be loaded."""


def huggingface_token() -> str:
    token = (
        os.environ.get("HF_TOKEN")
        or os.environ.get("HUGGING_FACE_HUB_TOKEN")
        or os.environ.get("HUGGINGFACE_HUB_TOKEN")
        or ""
    ).strip()
    if not token:
        raise Sam3dAccessError(
            "HuggingFace access to SAM 3D Body is required. "
            "Set HF_TOKEN as a Replicate secret after accepting "
            "facebook/sam-3d-body-dinov3. Do not stub the initializer."
        )
    return token


def ensure_sam3d_on_path() -> None:
    root = os.environ.get("SAM3D_BODY_ROOT", "/src/sam-3d-body")
    if os.path.isdir(root) and root not in sys.path:
        sys.path.insert(0, root)


def _mhr_torchscript_path() -> str:
    from huggingface_hub import snapshot_download

    local_dir = snapshot_download(repo_id=SAM3D_HF_REPO, token=huggingface_token())
    mhr_path = os.path.join(local_dir, "assets", "mhr_model.pt")
    if not os.path.isfile(mhr_path):
        raise Sam3dAccessError(
            f"SAM 3D Body snapshot at {local_dir} is missing assets/mhr_model.pt."
        )
    return mhr_path


def load_sam3d_estimator(device: Any) -> tuple[Any, str]:
    """Load the live SAM 3D Body estimator via official `setup_sam_3d_body`."""
    token = huggingface_token()
    os.environ.setdefault("HF_TOKEN", token)
    os.environ.setdefault("HUGGING_FACE_HUB_TOKEN", token)
    os.environ.setdefault("PYOPENGL_PLATFORM", "egl")
    ensure_sam3d_on_path()

    try:
        from notebook.utils import setup_sam_3d_body
    except ImportError as error:
        raise Sam3dAccessError(
            "facebookresearch/sam-3d-body is not importable "
            "(notebook.utils.setup_sam_3d_body). "
            "Clone it at SAM3D_BODY_ROOT and install its dependencies. "
            "Do not stub SAM 3D Body."
        ) from error

    try:
        # Official README defaults also load ViTDet. We already have a bbox from
        # Apache SAM 2, so skip the detector to keep A100 VRAM for DINOv3 + MoGe2 + MHR.
        estimator = setup_sam_3d_body(
            hf_repo_id=SAM3D_HF_REPO,
            device=str(device),
            detector_name="",
        )
    except Exception as error:
        raise Sam3dAccessError(
            f"Failed to load gated SAM 3D Body from {SAM3D_HF_REPO}: {error}. "
            "Do not stub the initializer."
        ) from error

    return estimator, _mhr_torchscript_path()


def _pick_person(outputs: list[dict[str, Any]], image_wh: tuple[int, int]) -> dict[str, Any]:
    if not outputs:
        raise RuntimeError("SAM 3D Body returned no person. Refusing to invent an initializer.")

    width, height = image_wh
    cx, cy = width * 0.5, height * 0.5

    def score(person: dict[str, Any]) -> float:
        bbox = np.asarray(person["bbox"], dtype=np.float32).reshape(-1)
        pcx = 0.5 * (bbox[0] + bbox[2])
        pcy = 0.5 * (bbox[1] + bbox[3])
        area = max(1.0, float((bbox[2] - bbox[0]) * (bbox[3] - bbox[1])))
        dist = (pcx - cx) ** 2 + (pcy - cy) ** 2
        return area / (1.0 + dist)

    return max(outputs, key=score)


def initialize_view(
    estimator: Any,
    image_rgb: np.ndarray,
    mask: np.ndarray,
    bbox: np.ndarray,
) -> dict[str, Any]:
    """Run official `process_one_image` on RGB, prompted with our SAM 2 silhouette."""
    import torch

    height, width = image_rgb.shape[:2]
    mask_u8 = (np.asarray(mask).reshape(height, width) > 0).astype(np.uint8) * 255
    with torch.no_grad():
        outputs = estimator.process_one_image(
            image_rgb,
            bboxes=bbox.reshape(1, 4).astype(np.float32),
            masks=mask_u8,
        )
    person = _pick_person(outputs, (width, height))
    required = (
        "shape_params",
        "scale_params",
        "body_pose_params",
        "global_rot",
        "pred_cam_t",
        "pred_keypoints_2d",
        "pred_keypoints_3d",
        "focal_length",
        "bbox",
    )
    missing = [key for key in required if key not in person]
    if missing:
        raise RuntimeError(f"SAM 3D Body output missing {missing}. Do not stub parameters.")
    return person
