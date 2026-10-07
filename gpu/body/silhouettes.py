"""SAM 2 person silhouettes (Apache 2.0). Face pixels are already cropped on-device."""

from __future__ import annotations

import cv2
import numpy as np
import torch

from .topology import SAM2_HF_ID


# Prompt grid (fractions of W, H) over where a head-cropped torso can sit. One
# centred point lands on the wall: between the legs in the front A-pose, and in
# front of the body in the side view (the outline is centred on body + arms).
PROMPT_XS = (0.3, 0.4, 0.5, 0.6, 0.7)
PROMPT_YS = (0.15, 0.3, 0.45)


def person_mask_area(mask: np.ndarray) -> float | None:
    """Area fraction if the mask is shaped like a head-cropped standing person, else None.

    The capture frames the body from the cropped neck to the feet. Wall and
    floor masks wrap the frame edges; a person touches the top and bottom rows
    only at the neck and feet.
    """
    binary = np.asarray(mask) > 0.5
    height, width = binary.shape
    area = float(binary.mean())
    if not 0.04 <= area <= 0.7:
        return None
    rows = np.flatnonzero(binary.any(axis=1))
    if rows[0] > 0.2 * height or rows[-1] < 0.75 * height:
        return None
    if 0.5 * (binary[:, 0].mean() + binary[:, -1].mean()) > 0.25:
        return None
    if binary[0].mean() > 0.6 or binary[-1].mean() > 0.5:
        return None
    # A person is one solid region; low-contrast wall comes back as speckle.
    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary.astype(np.uint8), connectivity=8)
    if count < 2 or stats[1:, cv2.CC_STAT_AREA].max() < 0.9 * binary.sum():
        return None
    return area


def pick_person_mask(candidates: list[np.ndarray]) -> np.ndarray | None:
    """Most-agreed person-shaped mask across prompts (IoU >= 0.9 votes); area breaks ties."""
    plausible = [(mask > 0.5) for mask in candidates if person_mask_area(mask) is not None]
    if not plausible:
        return None

    def votes(mask: np.ndarray) -> int:
        total = 0
        for other in plausible:
            union = np.logical_or(mask, other).sum()
            if union and np.logical_and(mask, other).sum() / union >= 0.9:
                total += 1
        return total

    return max(plausible, key=lambda mask: (votes(mask), mask.sum()))


def segment_person(predictor, image_rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Return a boolean HxW silhouette and an xyxy bbox for the standing person."""
    height, width = image_rgb.shape[:2]
    candidates: list[np.ndarray] = []

    with torch.inference_mode():
        # The image encoder runs once; each prompt is a cheap decoder pass.
        predictor.set_image(image_rgb)
        for fy in PROMPT_YS:
            for fx in PROMPT_XS:
                masks, _scores, _ = predictor.predict(
                    point_coords=np.array([[width * fx, height * fy]], dtype=np.float32),
                    point_labels=np.array([1], dtype=np.int32),
                    multimask_output=True,
                )
                candidates.extend(np.asarray(masks).reshape(-1, height, width))

    mask = pick_person_mask(candidates)
    if mask is None:
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
