"""Radial garment-to-body clearance in centimetres (loose regions = large)."""

from __future__ import annotations

import numpy as np


def build_radial_field(
    collider: np.ndarray,
    bin_count: int = 64,
) -> tuple[float, float, np.ndarray]:
    y = collider[:, 1]
    y_min = float(y.min())
    y_max = float(y.max())
    height = max(y_max - y_min, 1e-4)
    radii: list[list[float]] = [[] for _ in range(bin_count)]
    for vertex in collider:
        t = (float(vertex[1]) - y_min) / height
        bin_index = min(bin_count - 1, int(t * bin_count))
        radii[bin_index].append(float(np.hypot(vertex[0], vertex[2])))

    field = np.zeros(bin_count, dtype=np.float32)
    last = 0.12
    for bin_index, samples in enumerate(radii):
        if samples:
            samples.sort()
            last = samples[int((len(samples) - 1) * 0.65)]
        field[bin_index] = last

    for bin_index in range(bin_count - 2, -1, -1):
        if len(radii[bin_index]) == 0:
            field[bin_index] = field[bin_index + 1]
    return y_min, y_max, field


def sample_radius(y: np.ndarray, y_min: float, y_max: float, field: np.ndarray) -> np.ndarray:
    t = np.clip((y - y_min) / max(y_max - y_min, 1e-4), 0.0, 1.0)
    exact = t * (field.shape[0] - 1)
    lower = np.floor(exact).astype(np.int32)
    upper = np.minimum(field.shape[0] - 1, lower + 1)
    frac = exact - lower
    return field[lower] * (1.0 - frac) + field[upper] * frac


def clearance_cm(cloth: np.ndarray, collider: np.ndarray) -> np.ndarray:
    y_min, y_max, field = build_radial_field(collider)
    horizontal = np.hypot(cloth[:, 0], cloth[:, 2])
    body_radius = sample_radius(cloth[:, 1], y_min, y_max, field)
    return ((horizontal - body_radius) * 100.0).astype(np.float32)


def vertex_strain(rest: np.ndarray, draped: np.ndarray, indices: np.ndarray) -> np.ndarray:
    vertex_count = rest.shape[0]
    strains = np.zeros(vertex_count, dtype=np.float32)
    counts = np.zeros(vertex_count, dtype=np.int32)
    faces = indices.reshape(-1, 3)

    def add_edge(a: int, b: int) -> None:
        rest_len = float(np.linalg.norm(rest[a] - rest[b]))
        draped_len = float(np.linalg.norm(draped[a] - draped[b]))
        value = (draped_len - rest_len) / max(rest_len, 1e-6)
        strains[a] += value
        strains[b] += value
        counts[a] += 1
        counts[b] += 1

    for a, b, c in faces:
        add_edge(int(a), int(b))
        add_edge(int(b), int(c))
        add_edge(int(c), int(a))

    valid = counts > 0
    strains[valid] /= counts[valid]
    return strains
