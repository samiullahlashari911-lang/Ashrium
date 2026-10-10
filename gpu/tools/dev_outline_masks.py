"""Dev-only: SAM 2 person masks of model photos for the capture outlines.

Not shopper data: model photos supplied by the owner for the guide shape
(female from 2026-10-10). Writes `gpu/tools/outline_masks/{name}.png` (white
person on black, photo size), which `build_outlines.py` traces.

    python -m modal run gpu/tools/dev_outline_masks.py \
        --photo front.jpg --name female_front --points "0.5,0.2 0.5,0.4 0.4,0.75 0.6,0.75"

`points` are positive clicks as fractions of width,height on the person.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import modal

GPU_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(GPU_DIR))

from modal_app import WEIGHTS_MOUNT, image, weights  # noqa: E402  (same image as production)

dev = modal.App("ashrium-dev-outline-masks")


@dev.function(image=image, gpu=["A100-80GB", "A100-40GB", "L40S"], timeout=600, volumes={WEIGHTS_MOUNT: weights})
def person_mask(photo: bytes, points: list[list[float]]) -> bytes:
    import cv2
    import numpy as np
    import torch

    if "/opt/ashrium" not in sys.path:
        sys.path.insert(0, "/opt/ashrium")
    from body.prefetch_weights import configure_hf_cache
    from body.silhouettes import load_sam2_predictor

    configure_hf_cache()
    rgb = cv2.cvtColor(cv2.imdecode(np.frombuffer(photo, np.uint8), cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB)
    height, width = rgb.shape[:2]
    predictor = load_sam2_predictor(torch.device("cuda"))
    coords = np.array([[x * width, y * height] for x, y in points], dtype=np.float32)
    with torch.inference_mode():
        predictor.set_image(rgb)
        masks, scores, _ = predictor.predict(
            point_coords=coords,
            point_labels=np.ones(len(coords), dtype=np.int32),
            multimask_output=True,
        )
    # The whole person: the largest candidate that keeps every click inside.
    best = None
    for mask in np.asarray(masks).reshape(-1, height, width) > 0.5:
        if all(mask[int(y), int(x)] for x, y in coords) and (best is None or mask.sum() > best.sum()):
            best = mask
    if best is None:
        best = np.asarray(masks)[int(np.argmax(scores))] > 0.5
    count, labels, stats, _ = cv2.connectedComponentsWithStats(best.astype(np.uint8), connectivity=8)
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    out = (labels == largest).astype(np.uint8) * 255
    ok, png = cv2.imencode(".png", out)
    if not ok:
        raise RuntimeError("PNG encode failed")
    return png.tobytes()


@dev.local_entrypoint()
def main(photo: str, name: str, points: str) -> None:
    clicks = [[float(value) for value in pair.split(",")] for pair in points.split()]
    png = person_mask.remote(Path(photo).read_bytes(), clicks)
    out = GPU_DIR / "tools" / "outline_masks" / f"{name}.png"
    out.write_bytes(png)
    print(f"wrote {os.path.relpath(out)}")
