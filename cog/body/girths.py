"""ISO 8559-1 girths: plane slice + 2D convex hull. Horizontal torso; arm filter.

Chest / waist / hip search windows come from stable native MHR torso joints
(root, uplegs, lumbar–thoracic spine, clavicles), not from stature fractions.
Canonical-pose plane slicing, convex hulls, and arm exclusion stay.
"""

from __future__ import annotations

import numpy as np

from .topology import (
    MHR_JOINT_C_SPINE0,
    MHR_JOINT_C_SPINE1,
    MHR_JOINT_C_SPINE2,
    MHR_JOINT_C_SPINE3,
    MHR_JOINT_COUNT,
    MHR_JOINT_L_CLAVICLE,
    MHR_JOINT_L_UPLEG,
    MHR_JOINT_R_CLAVICLE,
    MHR_JOINT_R_UPLEG,
    MHR_JOINT_ROOT,
)

# Fallback only when joints are unavailable (tests / debug). Production always
# passes 127 native joints.
CHEST_STATURE_FRACTION = 0.72
WAIST_STATURE_FRACTION = 0.61
HIP_STATURE_FRACTION = 0.53
SLICE_HALF_THICKNESS_CM = 0.8
GIRTH_WINDOW_SAMPLES = 7
# Lateral pad vs clavicle / hip-joint half-span so bust and seat stay in-slice
# while A-pose arms stay out.
CHEST_CLAVICLE_SPAN_PAD = 1.25
WAIST_SPAN_BLEND = 0.9
HIP_JOINT_SPAN_PAD = 1.35
# ISO seat is below the hip joints; scale the drop from lumbar-to-hip span.
HIP_BELOW_JOINT_FRAC = 0.45


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


def _require_joints_cm(joints_cm: np.ndarray) -> np.ndarray:
    joints = np.asarray(joints_cm, dtype=np.float64)
    if joints.ndim != 2 or joints.shape != (MHR_JOINT_COUNT, 3):
        raise RuntimeError(
            f"Girth joints must be ({MHR_JOINT_COUNT}, 3) native MHR coordinates in centimetres."
        )
    if not np.isfinite(joints).all():
        raise RuntimeError("Girth joints contain non-finite values.")
    return joints


def _joint_up(joints: np.ndarray, index: int, up_axis: int) -> float:
    return float(joints[index, up_axis])


def _mid_half(joints: np.ndarray, left: int, right: int, horiz: int, pad: float) -> tuple[float, float]:
    a = float(joints[left, horiz])
    b = float(joints[right, horiz])
    midline = 0.5 * (a + b)
    half = 0.5 * abs(b - a) * pad
    return midline, max(half, 6.0)


def torso_search_windows(
    joints_cm: np.ndarray,
    up_axis: int,
) -> dict[str, dict[str, float]]:
    """Chest / waist / hip [lo, hi] plus landmark plane, from native torso joints."""
    joints = _require_joints_cm(joints_cm)
    horiz, _ = _horizontal_axes(up_axis)
    root = _joint_up(joints, MHR_JOINT_ROOT, up_axis)
    spine0 = _joint_up(joints, MHR_JOINT_C_SPINE0, up_axis)
    spine1 = _joint_up(joints, MHR_JOINT_C_SPINE1, up_axis)
    spine2 = _joint_up(joints, MHR_JOINT_C_SPINE2, up_axis)
    spine3 = _joint_up(joints, MHR_JOINT_C_SPINE3, up_axis)
    hip = 0.5 * (
        _joint_up(joints, MHR_JOINT_L_UPLEG, up_axis)
        + _joint_up(joints, MHR_JOINT_R_UPLEG, up_axis)
    )
    clav = 0.5 * (
        _joint_up(joints, MHR_JOINT_L_CLAVICLE, up_axis)
        + _joint_up(joints, MHR_JOINT_R_CLAVICLE, up_axis)
    )
    lumbar_span = max(abs(spine0 - hip), 8.0)
    hip_lo = hip - HIP_BELOW_JOINT_FRAC * lumbar_span
    chest_plane = 0.5 * (spine2 + spine3)
    chest_mid, chest_half = _mid_half(
        joints, MHR_JOINT_L_CLAVICLE, MHR_JOINT_R_CLAVICLE, horiz, CHEST_CLAVICLE_SPAN_PAD
    )
    hip_mid, hip_half = _mid_half(
        joints, MHR_JOINT_L_UPLEG, MHR_JOINT_R_UPLEG, horiz, HIP_JOINT_SPAN_PAD
    )
    waist_mid = 0.5 * (chest_mid + hip_mid)
    waist_half = max(6.0, 0.5 * (chest_half + hip_half) * WAIST_SPAN_BLEND)

    def window(a: float, b: float, plane: float) -> dict[str, float]:
        lo, hi = (a, b) if a <= b else (b, a)
        if hi - lo < SLICE_HALF_THICKNESS_CM:
            pad = SLICE_HALF_THICKNESS_CM
            lo, hi = plane - pad, plane + pad
        plane = min(max(plane, lo), hi)
        return {"lo": float(lo), "hi": float(hi), "plane": float(plane)}

    return {
        "chest": window(spine1, clav, chest_plane),
        "waist": window(root, spine1, spine0),
        "hip": window(hip_lo, root, 0.5 * (hip + root)),
        "lateral": {
            "chest_mid": chest_mid,
            "chest_half": chest_half,
            "waist_mid": waist_mid,
            "waist_half": waist_half,
            "hip_mid": hip_mid,
            "hip_half": hip_half,
        },
    }


def _clamp_window(window: dict[str, float], y_min: float, y_max: float) -> dict[str, float]:
    plane = min(max(float(window["plane"]), y_min), y_max)
    lo = min(max(float(window["lo"]), y_min), y_max)
    hi = min(max(float(window["hi"]), y_min), y_max)
    if hi < lo:
        lo, hi = hi, lo
    if hi - lo < SLICE_HALF_THICKNESS_CM:
        lo = max(y_min, plane - SLICE_HALF_THICKNESS_CM)
        hi = min(y_max, plane + SLICE_HALF_THICKNESS_CM)
        if hi < lo:
            lo, hi = y_min, y_max
    plane = min(max(plane, lo), hi)
    return {"lo": float(lo), "hi": float(hi), "plane": float(plane)}


def _torso_mask(
    vertices: np.ndarray,
    up_axis: int,
    y_lo: float,
    y_hi: float,
    width_frac: float,
    midline: float | None = None,
    limit: float | None = None,
) -> np.ndarray:
    up = vertices[:, up_axis]
    band = (up >= y_lo) & (up <= y_hi)
    horiz_a, _horiz_b = _horizontal_axes(up_axis)
    lateral = vertices[:, horiz_a]
    if midline is not None and limit is not None:
        return band & (np.abs(lateral - midline) <= limit)

    shoulder_lo = y_lo + 0.75 * (y_hi - y_lo)
    shoulder = band & (up >= shoulder_lo)
    if int(shoulder.sum()) < 16:
        shoulder = band
    half_span = 0.5 * (float(lateral[shoulder].max()) - float(lateral[shoulder].min()))
    inferred_mid = 0.5 * (float(lateral[shoulder].max()) + float(lateral[shoulder].min()))
    inferred_limit = max(half_span * width_frac, 1.0)
    return band & (np.abs(lateral - inferred_mid) <= inferred_limit)


def _slice_girth_cm(
    vertices: np.ndarray,
    up_axis: int,
    plane_up: float,
    width_frac: float,
    y_lo: float | None = None,
    y_hi: float | None = None,
    midline: float | None = None,
    limit: float | None = None,
) -> float:
    up = vertices[:, up_axis]
    y_min = float(up.min()) if y_lo is None else float(y_lo)
    y_max = float(up.max()) if y_hi is None else float(y_hi)
    band = _torso_mask(vertices, up_axis, y_min, y_max, width_frac, midline, limit)
    near_plane = band & (np.abs(up - plane_up) <= SLICE_HALF_THICKNESS_CM)
    axis_a, axis_b = _horizontal_axes(up_axis)
    points = vertices[near_plane][:, [axis_a, axis_b]]
    if points.shape[0] < 12:
        near_plane = band & (np.abs(up - plane_up) <= SLICE_HALF_THICKNESS_CM * 2.5)
        points = vertices[near_plane][:, [axis_a, axis_b]]
    hull = convex_hull_2d(points)
    return hull_perimeter(hull)


def _search_girth_cm(
    vertices: np.ndarray,
    up_axis: int,
    window: dict[str, float],
    width_frac: float,
    mode: str,
    midline: float,
    limit: float,
) -> float:
    lo = float(window["lo"])
    hi = float(window["hi"])
    plane = float(window["plane"])
    if mode == "plane" or hi - lo <= SLICE_HALF_THICKNESS_CM:
        return _slice_girth_cm(
            vertices, up_axis, plane, width_frac, lo, hi, midline, limit
        )

    samples = np.linspace(lo, hi, GIRTH_WINDOW_SAMPLES, dtype=np.float64)
    values: list[float] = []
    for sample in samples:
        try:
            values.append(
                _slice_girth_cm(
                    vertices, up_axis, float(sample), width_frac, lo, hi, midline, limit
                )
            )
        except RuntimeError:
            continue
    if not values:
        return _slice_girth_cm(
            vertices, up_axis, plane, width_frac, lo, hi, midline, limit
        )
    if mode == "min":
        return float(min(values))
    return float(max(values))


def measure_chest_waist_hip_cm(
    vertices: np.ndarray,
    joints_cm: np.ndarray | None = None,
) -> dict[str, float]:
    """vertices: (V, 3) canonical-pose MHR LOD 1, centimetres.

    When `joints_cm` is (127, 3), chest/waist/hip planes are taken from native
    torso joints. Bust and hip take the max girth in that window; waist takes
    the min (natural indentation).
    """
    if vertices.ndim != 2 or vertices.shape[1] != 3:
        raise RuntimeError("Canonical mesh must be (V, 3).")

    up_axis = _up_axis(vertices)
    up = vertices[:, up_axis]
    y_min = float(up.min())
    stature = float(up.max() - y_min)
    if stature < 50:
        raise RuntimeError("Canonical mesh stature is implausible for a centimetre MHR mesh.")

    if joints_cm is None:
        chest = _slice_girth_cm(
            vertices, up_axis, y_min + CHEST_STATURE_FRACTION * stature, 0.42
        )
        waist = _slice_girth_cm(
            vertices, up_axis, y_min + WAIST_STATURE_FRACTION * stature, 0.48
        )
        hip = _slice_girth_cm(
            vertices, up_axis, y_min + HIP_STATURE_FRACTION * stature, 0.58
        )
        return {
            "chest_cm": float(chest),
            "waist_cm": float(waist),
            "hip_cm": float(hip),
        }

    windows = torso_search_windows(joints_cm, up_axis)
    windows["chest"] = _clamp_window(windows["chest"], y_min, y_min + stature)
    windows["waist"] = _clamp_window(windows["waist"], y_min, y_min + stature)
    windows["hip"] = _clamp_window(windows["hip"], y_min, y_min + stature)
    lateral = windows["lateral"]
    chest = _search_girth_cm(
        vertices,
        up_axis,
        windows["chest"],
        0.42,
        "max",
        lateral["chest_mid"],
        lateral["chest_half"],
    )
    waist = _search_girth_cm(
        vertices,
        up_axis,
        windows["waist"],
        0.48,
        "min",
        lateral["waist_mid"],
        lateral["waist_half"],
    )
    hip = _search_girth_cm(
        vertices,
        up_axis,
        windows["hip"],
        0.58,
        "max",
        lateral["hip_mid"],
        lateral["hip_half"],
    )
    return {
        "chest_cm": float(chest),
        "waist_cm": float(waist),
        "hip_cm": float(hip),
    }
