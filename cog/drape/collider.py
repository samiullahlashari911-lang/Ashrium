"""Rigid MHR LOD 3 collider (~4,899 verts) from the live LOD 1 mesh."""

from __future__ import annotations

import numpy as np

from body.topology import MHR_LOD3_VERTEX_COUNT, MHR_LOD3_VERTEX_MAX, MHR_LOD3_VERTEX_MIN


def _as_finite_array(value: object, label: str) -> np.ndarray:
    array = np.asarray(value, dtype=np.float64)
    if array.size == 0 or not np.isfinite(array).all():
        raise RuntimeError(f"{label} must be a non-empty finite array.")
    return array


def parse_collider_mesh(
    positions: object,
    indices: object,
) -> tuple[np.ndarray, np.ndarray]:
    verts = _as_finite_array(positions, "collider_positions").reshape(-1, 3).astype(np.float32)
    faces = np.asarray(indices, dtype=np.int64).reshape(-1)
    if faces.size % 3 != 0 or faces.size < 3:
        raise RuntimeError("collider_indices must be triangle faces.")
    if faces.min() < 0 or int(faces.max()) >= verts.shape[0]:
        raise RuntimeError("collider_indices reference missing vertices.")
    return verts, faces.astype(np.int32)


def _cluster_vertices(
    positions: np.ndarray,
    indices: np.ndarray,
    cell_size: float,
) -> tuple[np.ndarray, np.ndarray]:
    origin = positions.min(axis=0)
    cells = np.floor((positions - origin) / max(cell_size, 1e-6)).astype(np.int64)
    keys = cells[:, 0] * 1_000_003 + cells[:, 1] * 1_009 + cells[:, 2]
    unique_keys, inverse = np.unique(keys, return_inverse=True)
    clustered = np.zeros((unique_keys.shape[0], 3), dtype=np.float32)
    counts = np.zeros(unique_keys.shape[0], dtype=np.int32)
    for index, cluster in enumerate(inverse):
        clustered[cluster] += positions[index]
        counts[cluster] += 1
    clustered /= np.maximum(counts[:, None], 1)

    remapped = inverse[indices.reshape(-1, 3)]
    keep = (
        (remapped[:, 0] != remapped[:, 1])
        & (remapped[:, 1] != remapped[:, 2])
        & (remapped[:, 2] != remapped[:, 0])
    )
    faces = remapped[keep].reshape(-1).astype(np.int32)
    return clustered, faces


def downsample_to_lod3(
    positions: np.ndarray,
    indices: np.ndarray,
    target_count: int = MHR_LOD3_VERTEX_COUNT,
) -> tuple[np.ndarray, np.ndarray]:
    """Cluster-decimate the rigid collider. Fail closed outside the LOD 3 band."""

    if positions.shape[0] <= MHR_LOD3_VERTEX_MAX and positions.shape[0] >= MHR_LOD3_VERTEX_MIN:
        return positions.astype(np.float32), indices.astype(np.int32)

    span = float(np.max(positions.max(axis=0) - positions.min(axis=0)))
    cell = max(span / 42.0, 1e-4)
    clustered, faces = _cluster_vertices(positions, indices, cell)
    for _ in range(8):
        if clustered.shape[0] > MHR_LOD3_VERTEX_MAX:
            cell *= 1.18
        elif clustered.shape[0] < MHR_LOD3_VERTEX_MIN:
            cell *= 0.84
        else:
            break
        clustered, faces = _cluster_vertices(positions, indices, cell)

    vertex_count = int(clustered.shape[0])
    if vertex_count < MHR_LOD3_VERTEX_MIN or vertex_count > MHR_LOD3_VERTEX_MAX:
        raise RuntimeError(
            f"MHR LOD 3 collider must have {MHR_LOD3_VERTEX_MIN}–{MHR_LOD3_VERTEX_MAX} "
            f"vertices, got {vertex_count} (target {target_count})."
        )
    if faces.size < 24:
        raise RuntimeError("MHR LOD 3 collider has too few faces.")
    return clustered.astype(np.float32), faces.astype(np.int32)
