"""SAM 3D Body per-view initializer (SAM License on this step only). Never stubbed.

Loads the live estimator the same way Meta documents:

    from notebook.utils import setup_sam_3d_body
    estimator = setup_sam_3d_body(hf_repo_id="facebook/sam-3d-body-dinov3")
    outputs = estimator.process_one_image(rgb_image, inference_type="body")

Shopper inference uses the official body-only path so hand-refinement
decoders do not consume A100 time. DINOv3, MoGe2, our Apache SAM 2 Hiera
Large masks, and full MHR LOD 1 output stay in the pipeline.

We still prompt with our Apache SAM 2 silhouette (bbox + mask). That is the
locked Cog pipeline — not a replacement for `setup_sam_3d_body`. Demo
visualization (`visualize_sample_together`) is not part of the product output.
"""

from __future__ import annotations

import os
import sys
from typing import Any

import numpy as np

from .pins import DINOV3_GIT_SHA
from .topology import SAM3D_HF_REPO

# Official SAM3DBodyEstimator.process_one_image flag: body decoder only.
# Still returns full-body MHR (127 joints, LOD 1 verts, 204-value params).
SAM3D_INFERENCE_TYPE = "body"


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


def pin_dinov3_torch_hub() -> None:
    """Force SAM 3D Body's DINOv3 hub load onto a reviewed SHA, not floating main."""
    import torch

    original = torch.hub.load
    if getattr(original, "_ashrium_dinov3_pinned", False):
        return

    pinned_repo = f"facebookresearch/dinov3:{DINOV3_GIT_SHA}"
    local = os.environ.get("DINOV3_ROOT", "/src/dinov3")
    if os.path.isdir(local):
        hub_dir = torch.hub.get_dir()
        os.makedirs(hub_dir, exist_ok=True)
        cache_name = f"facebookresearch_dinov3_{DINOV3_GIT_SHA}"
        dest = os.path.join(hub_dir, cache_name)
        if not os.path.exists(dest):
            try:
                os.symlink(os.path.abspath(local), dest)
            except OSError:
                pass

    def load(repo_or_dir: Any, *args: Any, **kwargs: Any) -> Any:
        if isinstance(repo_or_dir, str) and repo_or_dir in (
            "facebookresearch/dinov3",
            "facebookresearch/dinov3:main",
        ):
            repo_or_dir = pinned_repo
        return original(repo_or_dir, *args, **kwargs)

    setattr(load, "_ashrium_dinov3_pinned", True)
    torch.hub.load = load


def _mhr_torchscript_path() -> str:
    from huggingface_hub import snapshot_download

    local_dir = snapshot_download(repo_id=SAM3D_HF_REPO, token=huggingface_token())
    mhr_path = os.path.join(local_dir, "assets", "mhr_model.pt")
    if not os.path.isfile(mhr_path):
        raise Sam3dAccessError(
            f"SAM 3D Body snapshot at {local_dir} is missing assets/mhr_model.pt."
        )
    return mhr_path


def extract_loaded_mhr(estimator: Any) -> Any | None:
    """Reuse the MHR TorchScript already loaded inside SAM 3D Body."""
    model = getattr(estimator, "model", None)
    head = getattr(model, "head_pose", None) if model is not None else None
    for candidate in (
        getattr(head, "mhr", None) if head is not None else None,
        getattr(model, "mhr", None) if model is not None else None,
        getattr(estimator, "mhr", None),
    ):
        if candidate is None or not callable(candidate):
            continue
        if hasattr(candidate, "eval"):
            candidate.eval()
        return candidate
    return None


def load_sam3d_estimator(device: Any) -> tuple[Any, Any]:
    """Load the live SAM 3D Body estimator via official `setup_sam_3d_body`.

    Returns (estimator, mhr_module). The MHR module is the instance already
    loaded by SAM 3D Body — do not jit-load a second copy on the happy path.
    """
    token = huggingface_token()
    os.environ.setdefault("HF_TOKEN", token)
    os.environ.setdefault("HUGGING_FACE_HUB_TOKEN", token)
    os.environ.setdefault("PYOPENGL_PLATFORM", "egl")
    ensure_sam3d_on_path()
    pin_dinov3_torch_hub()

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
            fov_name="moge2",
        )
    except Exception as error:
        raise Sam3dAccessError(
            f"Failed to load gated SAM 3D Body from {SAM3D_HF_REPO}: {error}. "
            "Do not stub the initializer."
        ) from error

    mhr = extract_loaded_mhr(estimator)
    if mhr is None:
        import torch

        from .mhr_fit import load_mhr_script

        mhr = load_mhr_script(_mhr_torchscript_path(), torch.device(str(device)))
    elif hasattr(mhr, "to"):
        mhr.to(device)
    if hasattr(mhr, "eval"):
        mhr.eval()
    return estimator, mhr


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
            inference_type=SAM3D_INFERENCE_TYPE,
        )
    person = _pick_person(outputs, (width, height))
    required = (
        "shape_params",
        "mhr_model_params",
        "pred_joint_coords",
        "pred_cam_t",
        "focal_length",
        "bbox",
    )
    missing = [key for key in required if key not in person]
    if missing:
        raise RuntimeError(
            f"SAM 3D Body output missing {missing}. "
            "Need official 204-value mhr_model_params and 127-joint pred_joint_coords. "
            "Do not stub parameters or pad scale_params."
        )
    return person
