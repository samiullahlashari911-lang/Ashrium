"""Where each fitted MHR vertex lands in each uploaded photo (geometry only).

The browser paints the shopper's own photos onto their avatar on-device. The
server never sees the head and never returns pixels: it returns, per vertex
and per view, normalized image coordinates in the uploaded headless WebP and
a 0-255 weight (0 = hidden or facing away, 255 = facing the camera). The
browser maps head vertices (v < 0, above the crop) into its in-memory full
frame with the head-crop box it kept.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from .coords import SAM3D_METRES_TO_CM

FACES_PATH = Path(__file__).with_name("mhr_lod1_faces.npy")
# A nearer surface must be this much closer to hide a vertex (arm over torso).
OCCLUSION_TOLERANCE_M = 0.015
# Triangle z-buffer at image resolution: each camera-facing triangle is filled
# with barycentric samples at least this dense per projected pixel of edge.
SAMPLES_PER_EDGE_PX = 1.5
MAX_SAMPLES_PER_EDGE = 32
UV_DECIMALS = 4
# The upload starts under the chin; the head projects above it. The z-buffer
# reaches this many image heights above row 0 so head vertices get real
# visibility (the phone paints them from its full frame).
ABOVE_IMAGE_HEIGHTS = 1.0
# The fitted body is a little wider than the person in the photo; a vertex
# whose projection is not this many pixels inside the SAM 2 person mask would
# sample the wall, so it gets no weight (the phone fills it from its nearest
# seen neighbour). Only a yes/no per vertex leaves the GPU, never the mask.
MASK_ERODE_PX = 2

_faces_cache: np.ndarray | None = None


def mhr_lod1_faces() -> np.ndarray:
    global _faces_cache
    if _faces_cache is None:
        if not FACES_PATH.is_file():
            raise RuntimeError(
                f"{FACES_PATH.name} is missing. Run gpu/tools/build_mhr_faces.py."
            )
        _faces_cache = np.load(FACES_PATH).astype(np.int64)
    return _faces_cache


def mhr_cm_to_camera_m(vertices_cm: np.ndarray, cam_t_m: np.ndarray) -> np.ndarray:
    """MHR (cm, y up, z forward to viewer) → SAM 3D Body camera metres (y down, z away)."""
    sign = np.array([1.0, -1.0, -1.0])
    return vertices_cm * sign / SAM3D_METRES_TO_CM + np.asarray(cam_t_m, dtype=np.float64).reshape(1, 3)


def vertex_normals(points: np.ndarray, faces: np.ndarray) -> np.ndarray:
    a, b, c = points[faces[:, 0]], points[faces[:, 1]], points[faces[:, 2]]
    face_normals = np.cross(b - a, c - a)
    normals = np.zeros_like(points)
    for corner in range(3):
        np.add.at(normals, faces[:, corner], face_normals)
    length = np.linalg.norm(normals, axis=1, keepdims=True)
    return normals / np.maximum(length, 1e-12)


def erode_mask(mask: np.ndarray, pixels: int) -> np.ndarray:
    eroded = np.asarray(mask, dtype=bool).copy()
    for _ in range(pixels):
        shrunk = eroded.copy()
        shrunk[1:, :] &= eroded[:-1, :]
        shrunk[:-1, :] &= eroded[1:, :]
        shrunk[:, 1:] &= eroded[:, :-1]
        shrunk[:, :-1] &= eroded[:, 1:]
        eroded = shrunk
    return eroded


def project_view(
    vertices_cm: np.ndarray,
    focal: float,
    cam_t_m: np.ndarray,
    image_hw: tuple[int, int],
    faces: np.ndarray | None = None,
    person_mask: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Return (uv (V, 2) normalized to the image, weight (V,) uint8)."""
    faces = mhr_lod1_faces() if faces is None else faces
    height, width = image_hw
    camera = mhr_cm_to_camera_m(np.asarray(vertices_cm, dtype=np.float64), cam_t_m)
    depth = np.maximum(camera[:, 2], 1e-4)
    pixels = np.column_stack(
        [
            focal * camera[:, 0] / depth + width * 0.5,
            focal * camera[:, 1] / depth + height * 0.5,
        ]
    )
    uv = pixels / np.array([width, height], dtype=np.float64)

    normals = vertex_normals(camera, faces)
    to_camera = -camera / np.linalg.norm(camera, axis=1, keepdims=True)
    facing = np.clip((normals * to_camera).sum(axis=1), 0.0, 1.0)

    above = int(round(ABOVE_IMAGE_HEIGHTS * height))
    zbuffer = _triangle_zbuffer(camera, pixels, depth, faces, (height, width), above)
    px = np.clip(np.floor(pixels[:, 0]).astype(np.int64), 0, width - 1)
    py = np.clip(np.floor(pixels[:, 1]).astype(np.int64) + above, 0, above + height - 1)
    inside = (pixels[:, 0] >= 0) & (pixels[:, 0] < width) & (pixels[:, 1] >= -above) & (pixels[:, 1] < height)
    visible = inside & (facing > 0.0) & (depth <= zbuffer[py, px] + OCCLUSION_TOLERANCE_M)
    if person_mask is not None:
        if person_mask.shape != (height, width):
            raise RuntimeError("Person mask must match the image size.")
        core = erode_mask(person_mask, MASK_ERODE_PX)
        in_image = pixels[:, 1] >= 0  # the head (above the crop) has no mask
        mx = np.clip(np.floor(pixels[:, 0]).astype(np.int64), 0, width - 1)
        my = np.clip(np.floor(pixels[:, 1]).astype(np.int64), 0, height - 1)
        visible &= ~in_image | core[my, mx]
    weight = np.where(visible, np.round(facing * 255.0), 0.0).astype(np.uint8)
    return uv, weight


def _triangle_zbuffer(
    camera: np.ndarray,
    pixels: np.ndarray,
    depth: np.ndarray,
    faces: np.ndarray,
    image_hw: tuple[int, int],
    above: int,
) -> np.ndarray:
    """Nearest camera-facing surface depth per pixel (closed mesh: back faces never win).

    Rows start `above` pixels over the image so the head, above the crop, is covered.
    """
    height, width = image_hw
    a, b, c = camera[faces[:, 0]], camera[faces[:, 1]], camera[faces[:, 2]]
    toward = -(a + b + c) / 3.0
    faces = faces[(np.cross(b - a, c - a) * toward).sum(axis=1) > 0.0]

    tri_px = pixels[faces]
    tri_z = depth[faces]
    longest = np.max(
        np.linalg.norm(tri_px - np.roll(tri_px, -1, axis=1), axis=2), axis=1
    )
    steps = np.clip(np.ceil(longest * SAMPLES_PER_EDGE_PX), 1, MAX_SAMPLES_PER_EDGE).astype(np.int64)
    zbuffer = np.full((above + height, width), np.inf)
    for n in np.unique(steps):
        group = steps == n
        i, j = np.meshgrid(np.arange(n + 1), np.arange(n + 1), indexing="ij")
        keep = i + j <= n
        w1 = (i[keep] / n)[:, None]
        w2 = (j[keep] / n)[:, None]
        bary = np.concatenate([1.0 - w1 - w2, w1, w2], axis=1)
        sample_px = np.einsum("sk,tkd->tsd", bary, tri_px[group]).reshape(-1, 2)
        sample_z = (tri_z[group] @ bary.T).reshape(-1)
        sx = np.floor(sample_px[:, 0]).astype(np.int64)
        sy = np.floor(sample_px[:, 1]).astype(np.int64) + above
        on = (sx >= 0) & (sx < width) & (sy >= 0) & (sy < above + height)
        np.minimum.at(zbuffer, (sy[on], sx[on]), sample_z[on])
    return zbuffer


def photo_uv_payload(
    front_vertices_cm: np.ndarray,
    side_vertices_cm: np.ndarray,
    front_camera: tuple[float, np.ndarray, tuple[int, int]],
    side_camera: tuple[float, np.ndarray, tuple[int, int]],
    front_mask: np.ndarray | None = None,
    side_mask: np.ndarray | None = None,
) -> dict[str, list[float] | list[int]]:
    faces = mhr_lod1_faces()
    front_uv, front_weight = project_view(front_vertices_cm, *front_camera, faces=faces, person_mask=front_mask)
    side_uv, side_weight = project_view(side_vertices_cm, *side_camera, faces=faces, person_mask=side_mask)
    return {
        "front_uv": np.round(front_uv, UV_DECIMALS).reshape(-1).tolist(),
        "front_weight": front_weight.astype(int).tolist(),
        "side_uv": np.round(side_uv, UV_DECIMALS).reshape(-1).tolist(),
        "side_weight": side_weight.astype(int).tolist(),
    }
