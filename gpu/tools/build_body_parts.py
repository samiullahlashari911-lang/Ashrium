"""Offline: per-vertex body part labels for MHR LOD 1 (`mhr-18439-127`).

Writes public/models/mhr-parts.bin (one uint8 per vertex). Labels are traced
once on the MHR mean body in its canonical A-pose and carry over to every
shopper because the vertex order is the topology. No biometrics.

The browser uses them to know which skin a garment replaces (a top: upper
torso + arms; a bottom: lower torso + legs); hands, feet and the head always
keep the shopper's own photo.

    python gpu/tools/build_body_parts.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "public" / "models" / "mhr-parts.bin"
sys.path.insert(0, str(REPO / "gpu"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

# One definition of "the arm stands clear of the torso", shared with the girths.
from body.girths import ARM_GAP_CM, TORSO_MIN_HALF_CM  # noqa: E402
from build_mhr_faces import read_glb_positions  # noqa: E402

# Must match lib/graphics/body-parts.ts.
HEAD = 0
UPPER_TORSO = 1  # chest, back, abdomen and neck, above the natural waist
LOWER_TORSO_LEGS = 2  # hips, seat and legs down to the ankle
ARM = 3
HAND = 4
FOOT = 5

SHOULDER_SEAM_PAD_CM = 0.5
HAND_LENGTH_CM = 19.0
ANKLE_CM = 9.0
WAIST_STATURE_FRACTION = 0.615
NECK_BELOW_CHIN_CM = 3.0
CHIN_BELOW_NOSE_CM = 8.5


def rest_mesh_cm() -> np.ndarray:
    return read_glb_positions().astype(np.float64) * 100.0


def armpit(vertices: np.ndarray, side: float) -> tuple[float, float, dict[float, float]]:
    """(armpit height, torso edge there, per-slice torso/arm gap midpoint) for one side."""
    # Scan down from the shoulder: the armpit is the first slice where the arm
    # separates; the gap then holds down to the fingertips. (Scanning up from
    # the hips would catch the small thigh-to-hand gap first.)
    x, y = vertices[:, 0] * side, vertices[:, 1]
    edges: dict[float, float] = {}
    first = (float("nan"), float("nan"))
    for height in np.arange(150.0, 60.0, -0.5):
        lateral = np.sort(x[(np.abs(y - height) <= 0.8) & (x > TORSO_MIN_HALF_CM)])
        if lateral.size < 2:
            if edges:
                break
            continue
        gaps = np.diff(lateral)
        widest = int(np.argmax(gaps))
        if gaps[widest] < ARM_GAP_CM:
            if edges:
                break
            continue
        if not edges:
            first = (float(height), float(lateral[widest]))
        edges[float(height)] = float(lateral[widest] + 0.5 * gaps[widest])
    if not edges:
        raise RuntimeError("No torso/arm gap: the mesh is not in the canonical A-pose.")
    return first[0], first[1], edges


def label_vertices(vertices: np.ndarray) -> np.ndarray:
    x, y, z = vertices.T
    floor = float(y.min())
    stature = float(y.max()) - floor
    labels = np.full(vertices.shape[0], UPPER_TORSO, dtype=np.uint8)

    head_zone = y > floor + 0.84 * stature
    nose = int(np.argmax(np.where(head_zone & (np.abs(x) < 1.5), z, -np.inf)))
    neck_y = float(y[nose]) - CHIN_BELOW_NOSE_CM - NECK_BELOW_CHIN_CM
    waist_y = floor + WAIST_STATURE_FRACTION * stature

    for side in (1.0, -1.0):
        armpit_y, torso_edge, gaps = armpit(vertices, side)
        seam = torso_edge + SHOULDER_SEAM_PAD_CM
        lateral = x * side
        below = np.array([gaps.get(round(float(h) * 2) / 2, np.inf) for h in y])
        arm = (lateral > 6.0) & (
            ((y < armpit_y) & (lateral > below))
            | ((y >= armpit_y) & (y < neck_y) & (lateral > seam))
        )
        # Hands: the last HAND_LENGTH_CM along the arm, from shoulder to fingertip.
        shoulder = np.array([seam, armpit_y])
        tip = vertices[arm][np.argmax(lateral[arm])]
        axis = np.array([tip[0] * side, tip[1]]) - shoulder
        axis /= np.linalg.norm(axis)
        reach = (lateral - shoulder[0]) * axis[0] + (y - shoulder[1]) * axis[1]
        hand = arm & (reach > reach[arm].max() - HAND_LENGTH_CM)
        labels[arm] = ARM
        labels[hand] = HAND

    body = (labels != ARM) & (labels != HAND)
    labels[body & (y >= neck_y)] = HEAD
    labels[body & (y < waist_y)] = LOWER_TORSO_LEGS
    labels[body & (y < floor + ANKLE_CM)] = FOOT
    return labels


def main() -> None:
    labels = label_vertices(rest_mesh_cm())
    OUT.write_bytes(labels.tobytes())
    names = ["head", "upper_torso", "lower_torso_legs", "arm", "hand", "foot"]
    counts = {name: int((labels == index).sum()) for index, name in enumerate(names)}
    print(f"wrote {OUT.relative_to(REPO)}: {counts}")


if __name__ == "__main__":
    main()
