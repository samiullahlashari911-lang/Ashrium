"""SAM 2 person silhouettes (Apache 2.0). Face pixels are already cropped on-device."""

from __future__ import annotations

import numpy as np
import torch

from .topology import SAM2_HF_ID


def _largest_reasonable_mask(masks: np.ndarray, scores: np.ndarray) -> np.ndarray:
    if masks.ndim == 2:
        return masks > 0.5

    areas = masks.reshape(masks.shape[0], -1).sum(axis=1)
    image_area = float(masks.shape[-1] * masks.shape[-2])
    ranked = np.argsort(-scores)
    for index in ranked:
        fraction = float(areas[index]) / image_area
        if 0.04 <= fraction <= 0.92:
            return masks[index] > 0.5

    return masks[int(np.argmax(scores))] > 0.5


def segment_person(predictor, image_rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Return a boolean HxW silhouette and an xyxy bbox from a centered body prompt."""
    height, width = image_rgb.shape[:2]
    point_coords = np.array([[width * 0.5, height * 0.58]], dtype=np.float32)
    point_labels = np.array([1], dtype=np.int32)

    with torch.inference_mode():
        predictor.set_image(image_rgb)
        masks, scores, _ = predictor.predict(
            point_coords=point_coords,
            point_labels=point_labels,
            multimask_output=False,
        )

    mask = _largest_reasonable_mask(np.asarray(masks), np.asarray(scores).reshape(-1))
    if int(mask.sum()) < 32:
        raise RuntimeError("SAM 2 did not find a person silhouette in the capture.")

    ys, xs = np.where(mask)
    pad_x = max(4, int(0.02 * width))
    pad_y = max(4, int(0.02 * height))
    bbox = np.array(
        [
            max(0, int(xs.min()) - pad_x),
            max(0, int(ys.min()) - pad_y),
            min(width - 1, int(xs.max()) + pad_x),
            min(height - 1, int(ys.max()) + pad_y),
        ],
        dtype=np.float32,
    )
    return mask.astype(bool), bbox


def load_sam2_predictor(device: torch.device):
    try:
        from sam2.sam2_image_predictor import SAM2ImagePredictor
    except ImportError as error:
        raise RuntimeError(
            "SAM 2 is required for silhouettes (Apache 2.0). "
            "Install facebookresearch/sam2 — do not stub the masker."
        ) from error

    predictor = SAM2ImagePredictor.from_pretrained(SAM2_HF_ID)
    if hasattr(predictor, "model"):
        predictor.model.to(device)
    return predictor
