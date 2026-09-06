"""ISO 8559-1 girths: plane slice + 2D convex hull. Horizontal torso; arm filter."""

from __future__ import annotations

import numpy as np

# Fraction of stature (heel → vertex max) for standing landmarks.
CHEST_STATURE_FRACTION = 0.72
WAIST_STATURE_FRACTION = 0.61
HIP_STATURE_FRACTION = 0.53
SLICE_HALF_THICKNESS_CM = 0.8


def _cross2(origin: np.ndarray, a: np.ndarray, b: np.ndarray) -> float:
    return float((a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0]))


def convex_hull_2d(points: np.ndarray) -> np.ndarray:
    unique = np.unique(np.asarray(points, dtype=np.float64), axis=0)
    if unique.shape[0] < 3:
        raise RuntimeError("Girth slice does not contain enough torso points.")

    ordered = unique[np.lexsort((unique[:, 1], unique[:, 0]))]
    lower: list[np.ndarray] = []
    for point in ordered:
        while len(lower) >= 2 and _cross2(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)

    upper: list[np.ndarray] = []
    for point in reversed(ordered):
        while len(upper) >= 2 and _cross2(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)

    hull = np.vstack(lower[:-1] + upper[:-1])
    if hull.shape[0] < 3:
        raise RuntimeError("Girth convex hull degenerated.")
    return hull


def hull_perimeter(hull: np.ndarray) -> float:
    shifted = np.roll(hull, -1, axis=0)
    return float(np.linalg.norm(hull - shifted, axis=1).sum())


def _up_axis(vertices: np.ndarray) -> int:
    spans = vertices.max(axis=0) - vertices.min(axis=0)
    return int(np.argmax(spans))


def _horizontal_axes(up_axis: int) -> tuple[int, int]:
    remaining = [axis for axis in (0, 1, 2) if axis != up_axis]
    return remaining[0], remaining[1]


def _torso_mask(vertices: np.ndarray, up_axis: int, y_lo: float, y_hi: float, width_frac: float) -> np.ndarray:
    up = vertices[:, up_axis]
    band = (up >= y_lo) & (up <= y_hi)
    horiz_a, _horiz_b = _horizontal_axes(up_axis)
    # Shoulder band: exclude vertices whose lateral offset looks like an A-pose arm.
    shoulder_lo = y_lo + 0.75 * (y_hi - y_lo)
    shoulder = band & (up >= shoulder_lo)
    if int(shoulder.sum()) < 16:
        shoulder = band
    lateral = vertices[:, horiz_a]
    half_span = 0.5 * (float(lateral[shoulder].max()) - float(lateral[shoulder].min()))
    midline = 0.5 * (float(lateral[shoulder].max()) + float(lateral[shoulder].min()))
    limit = max(half_span * width_frac, 1.0)
    return band & (np.abs(lateral - midline) <= limit)


def _slice_girth_cm(
    vertices: np.ndarray,
    up_axis: int,
    plane_up: float,
    width_frac: float,
) -> float:
    up = vertices[:, up_axis]
    y_min = float(up.min())
    y_max = float(up.max())
    band = _torso_mask(vertices, up_axis, y_min, y_max, width_frac)
    near_plane = band & (np.abs(up - plane_up) <= SLICE_HALF_THICKNESS_CM)
    axis_a, axis_b = _horizontal_axes(up_axis)
    points = vertices[near_plane][:, [axis_a, axis_b]]
    if points.shape[0] < 12:
        near_plane = band & (np.abs(up - plane_up) <= SLICE_HALF_THICKNESS_CM * 2.5)
        points = vertices[near_plane][:, [axis_a, axis_b]]
    hull = convex_hull_2d(points)
    return hull_perimeter(hull)


def measure_chest_waist_hip_cm(vertices: np.ndarray) -> dict[str, float]:
    """vertices: (V, 3) canonical-pose MHR LOD 1, centimetres."""
    if vertices.ndim != 2 or vertices.shape[1] != 3:
        raise RuntimeError("Canonical mesh must be (V, 3).")

    up_axis = _up_axis(vertices)
    up = vertices[:, up_axis]
    y_min = float(up.min())
    stature = float(up.max() - y_min)
    if stature < 50:
        raise RuntimeError("Canonical mesh stature is implausible for a centimetre MHR mesh.")

    chest = _slice_girth_cm(vertices, up_axis, y_min + CHEST_STATURE_FRACTION * stature, 0.42)
    waist = _slice_girth_cm(vertices, up_axis, y_min + WAIST_STATURE_FRACTION * stature, 0.48)
    hip = _slice_girth_cm(vertices, up_axis, y_min + HIP_STATURE_FRACTION * stature, 0.58)
    return {
        "chest_cm": float(chest),
        "waist_cm": float(waist),
        "hip_cm": float(hip),
    }
