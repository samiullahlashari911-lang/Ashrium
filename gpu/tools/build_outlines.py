"""Offline generator for the guided-capture outlines (not part of the Modal image).

Reads the shipped Meta MHR LOD 1 rest mesh (`public/models/mhr-hull.glb`,
Apache 2.0), poses the arms for each capture view, applies sex-specific
torso proportions, renders an orthographic silhouette, and traces it into a
single smooth cubic-Bezier SVG path. Output: `lib/widget/capture-outlines.ts`.

No biometrics are involved: the only input is the population-mean MHR mesh.

    python gpu/tools/build_outlines.py

Requires numpy + opencv-python (dev machine only).
"""

from __future__ import annotations

import json
import math
import struct
from pathlib import Path

import cv2
import numpy as np

REPO = Path(__file__).resolve().parents[2]
GLB = REPO / "public" / "models" / "mhr-hull.glb"
OUT = REPO / "lib" / "widget" / "capture-outlines.ts"

RENDER_HEIGHT_PX = 1400
CONTOUR_POINTS = 280
SMOOTH_SIGMA_PX = 7.0
ARM_RADIUS_M = 0.13

# Rest-pose landmarks of the MHR mean (metres, y up, +z forward, +x = body left).
SHOULDER_Y = 1.415
SHOULDER_X = 0.175
ARM_START_X = 0.15

# Sex-specific half-width multipliers by height band (fraction of stature), loosely
# following ANSUR II mean biacromial / waist / hip breadth ratios relative to the
# MHR mean. Depth (side view) multipliers add bust / seat for the female outline.
SEX_PROFILES: dict[str, dict[str, list[tuple[float, float]]]] = {
    "neutral": {"width": [(0.0, 1.0), (1.0, 1.0)], "depth": [(0.0, 1.0), (1.0, 1.0)]},
    "male": {
        "width": [(0.0, 1.0), (0.46, 1.0), (0.52, 0.98), (0.61, 1.0), (0.72, 1.04), (0.82, 1.08), (0.88, 1.02), (1.0, 1.0)],
        "depth": [(0.0, 1.0), (0.66, 1.0), (0.74, 1.04), (0.82, 1.02), (1.0, 1.0)],
    },
    "female": {
        "width": [(0.0, 1.0), (0.4, 1.02), (0.5, 1.1), (0.55, 1.08), (0.61, 0.86), (0.66, 0.88), (0.72, 0.93), (0.82, 0.88), (0.88, 0.95), (1.0, 0.95)],
        "depth": [(0.0, 1.0), (0.44, 1.0), (0.51, 1.12), (0.58, 0.97), (0.66, 1.0), (0.72, 1.14), (0.77, 1.06), (0.84, 1.0), (1.0, 1.0)],
    },
}



def load_mesh() -> tuple[np.ndarray, np.ndarray]:
    blob = GLB.read_bytes()
    json_len = struct.unpack_from("<I", blob, 12)[0]
    gltf = json.loads(blob[20 : 20 + json_len])
    bin_offset = 20 + json_len + 8
    prim = gltf["meshes"][0]["primitives"][0]

    def accessor(index: int, dtype: type, width: int) -> np.ndarray:
        acc = gltf["accessors"][index]
        view = gltf["bufferViews"][acc["bufferView"]]
        start = bin_offset + view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        return np.frombuffer(blob, dtype=dtype, count=acc["count"] * width, offset=start).reshape(-1, width)

    positions = accessor(prim["attributes"]["POSITION"], np.float32, 3).astype(np.float64)
    index_type = {5125: np.uint32, 5123: np.uint16}[gltf["accessors"][prim["indices"]]["componentType"]]
    faces = accessor(prim["indices"], index_type, 1).reshape(-1, 3).astype(np.int64)
    return positions, faces


def piecewise(profile: list[tuple[float, float]], t: np.ndarray) -> np.ndarray:
    xs = np.array([p[0] for p in profile])
    ys = np.array([p[1] for p in profile])
    return np.interp(t, xs, ys)


def rotation(axis: np.ndarray, angle: float) -> np.ndarray:
    axis = axis / np.linalg.norm(axis)
    x, y, z = axis
    c, s = math.cos(angle), math.sin(angle)
    C = 1 - c
    return np.array(
        [
            [c + x * x * C, x * y * C - z * s, x * z * C + y * s],
            [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
            [z * x * C - y * s, z * y * C + x * s, c + z * z * C],
        ]
    )


def arm_masks(v: np.ndarray) -> dict[float, tuple[np.ndarray, np.ndarray, np.ndarray]]:
    """Per side: (vertex mask, shoulder point, rest arm direction) from the rest A-pose.

    Arms are selected by distance to the shoulder->hand axis, so hips and
    thighs at the same width are never swept along with the arm.
    """
    masks: dict[float, tuple[np.ndarray, np.ndarray, np.ndarray]] = {}
    for side in (1.0, -1.0):
        shoulder = np.array([side * SHOULDER_X, SHOULDER_Y, 0.0])
        lateral = side * v[:, 0]
        tip = v[np.argmax(lateral)]
        direction = (tip - shoulder) / np.linalg.norm(tip - shoulder)
        rel = v - shoulder
        along = rel @ direction
        perpendicular = np.linalg.norm(rel - np.outer(along, direction), axis=1)
        mask = (along > -0.03) & (perpendicular < ARM_RADIUS_M) & (lateral > SHOULDER_X - 0.06)
        masks[side] = (mask, shoulder, direction)
    return masks


def pose_arms(v: np.ndarray, masks: dict[float, tuple[np.ndarray, np.ndarray, np.ndarray]], target_dir: np.ndarray) -> np.ndarray:
    """Rigidly swing each arm about its shoulder so it points along target_dir.

    A smooth ramp near the shoulder blends the rotation in, so the deltoid
    stays a curve instead of a hinge.
    """
    out = v.copy()
    for side, (mask, shoulder_rest, rest_dir) in masks.items():
        shoulder = shoulder_rest.copy()
        shoulder[0] = side * np.abs(v[mask][:, 0]).min() if mask.any() else shoulder[0]
        goal = target_dir * np.array([side, 1.0, 1.0])
        goal /= np.linalg.norm(goal)
        axis = np.cross(rest_dir, goal)
        if np.linalg.norm(axis) < 1e-6:
            continue
        angle = math.acos(float(np.clip(rest_dir @ goal, -1, 1)))
        along = (v - shoulder) @ rest_dir
        weight = np.clip((along + 0.02) / 0.1, 0.0, 1.0) * mask
        for index in np.nonzero(weight)[0]:
            r = rotation(axis, angle * weight[index])
            out[index] = shoulder + r @ (v[index] - shoulder)
    return out


def shape_for_sex(v: np.ndarray, arms: np.ndarray, sex: str) -> np.ndarray:
    profile = SEX_PROFILES[sex]
    t = (v[:, 1] - v[:, 1].min()) / (v[:, 1].max() - v[:, 1].min())
    out = v.copy()
    width = piecewise(profile["width"], t)
    depth = piecewise(profile["depth"], t)
    out[:, 0] = np.where(arms, v[:, 0], v[:, 0] * width)
    out[:, 2] = v[:, 2] * depth
    # Carry the arms with the shoulder so they stay attached.
    shoulder_t = (SHOULDER_Y - v[:, 1].min()) / (v[:, 1].max() - v[:, 1].min())
    shoulder_scale = float(piecewise(profile["width"], np.array([shoulder_t]))[0])
    out[arms, 0] = v[arms, 0] + np.sign(v[arms, 0]) * SHOULDER_X * (shoulder_scale - 1.0)
    return out


def silhouette(v: np.ndarray, faces: np.ndarray, horizontal_axis: int, flip: bool) -> np.ndarray:
    horizontal = v[:, horizontal_axis] * (-1 if flip else 1)
    vertical = v[:, 1]
    scale = (RENDER_HEIGHT_PX - 80) / (vertical.max() - vertical.min())
    width = int((horizontal.max() - horizontal.min()) * scale) + 80
    image = np.zeros((RENDER_HEIGHT_PX, width), np.uint8)
    points = np.stack(
        [(horizontal - horizontal.min()) * scale + 40, (vertical.max() - vertical) * scale + 40], axis=1
    )
    points = np.round(points * 4).astype(np.int32)
    for face in faces:
        cv2.fillConvexPoly(image, points[face], 255, lineType=cv2.LINE_8, shift=2)
    image = cv2.morphologyEx(image, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    return image


def smooth_contour(mask: np.ndarray) -> np.ndarray:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    contour = max(contours, key=cv2.contourArea)[:, 0, :].astype(np.float64)
    n = len(contour)
    radius = int(SMOOTH_SIGMA_PX * 3)
    kernel = np.exp(-0.5 * (np.arange(-radius, radius + 1) / SMOOTH_SIGMA_PX) ** 2)
    kernel /= kernel.sum()
    padded = np.concatenate([contour[-radius:], contour, contour[:radius]])
    smoothed = np.stack([np.convolve(padded[:, k], kernel, mode="valid") for k in (0, 1)], axis=1)[:n]
    # Resample by arc length so Bezier segments are even.
    seg = np.linalg.norm(np.diff(np.vstack([smoothed, smoothed[:1]]), axis=0), axis=1)
    cumulative = np.concatenate([[0], np.cumsum(seg)])
    targets = np.linspace(0, cumulative[-1], CONTOUR_POINTS, endpoint=False)
    closed = np.vstack([smoothed, smoothed[:1]])
    return np.stack([np.interp(targets, cumulative, closed[:, k]) for k in (0, 1)], axis=1)


def bezier_path(points: np.ndarray, scale: float) -> str:
    """Closed Catmull-Rom spline through points, emitted as cubic Beziers."""
    p = points * scale
    n = len(p)
    parts = [f"M{p[0, 0]:.1f} {p[0, 1]:.1f}"]
    for i in range(n):
        p0, p1, p2, p3 = p[(i - 1) % n], p[i], p[(i + 1) % n], p[(i + 2) % n]
        c1 = p1 + (p2 - p0) / 6
        c2 = p2 - (p3 - p1) / 6
        parts.append(f"C{c1[0]:.1f} {c1[1]:.1f} {c2[0]:.1f} {c2[1]:.1f} {p2[0]:.1f} {p2[1]:.1f}")
    return "".join(parts) + "Z"


def build() -> dict[str, dict[str, dict[str, object]]]:
    vertices, faces = load_mesh()
    masks = arm_masks(vertices)
    arms = masks[1.0][0] | masks[-1.0][0]
    outlines: dict[str, dict[str, dict[str, object]]] = {}
    view_height = 1000.0
    for sex in ("female", "male", "neutral"):
        shaped = shape_for_sex(vertices, arms, sex)
        # Front: MHR's own rest A-pose is the capture pose; re-posing adds an elbow kink.
        front_pose = shaped
        # Side: arms forward at shoulder height (wrists at/above shoulders gate).
        side_pose = pose_arms(shaped, masks, np.array([0.12, 0.05, 1.0]))
        outlines[sex] = {}
        for view, posed, axis, flip in (("front", front_pose, 0, True), ("side", side_pose, 2, False)):
            mask = silhouette(posed, faces, axis, flip)
            points = smooth_contour(mask)
            scale = view_height / mask.shape[0]
            outlines[sex][view] = {
                "viewBox": f"0 0 {mask.shape[1] * scale:.0f} {view_height:.0f}",
                "path": bezier_path(points, scale),
            }
    return outlines


def main() -> None:
    outlines = build()
    lines = [
        "// Generated by gpu/tools/build_outlines.py from public/models/mhr-hull.glb (Meta MHR, Apache 2.0).",
        "// Do not edit by hand; rerun the generator.",
        "",
        "import type { CaptureSex, CaptureView } from '@/types/hmr';",
        "",
        "export interface CaptureOutline {",
        "  viewBox: string;",
        "  path: string;",
        "}",
        "",
        "export const CAPTURE_OUTLINES: Record<CaptureSex, Record<CaptureView, CaptureOutline>> = {",
    ]
    key = {"female": "female", "male": "male", "neutral": "unspecified"}
    for sex, views in outlines.items():
        lines.append(f"  {key[sex]}: {{")
        for view, data in views.items():
            lines.append(f"    {view}: {{")
            lines.append(f"      viewBox: '{data['viewBox']}',")
            lines.append(f"      path: '{data['path']}',")
            lines.append("    },")
        lines.append("  },")
    lines.append("};")
    lines.append("")
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {OUT.relative_to(REPO)}")


if __name__ == "__main__":
    main()
