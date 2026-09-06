"""Rebuild the rest-length panel into a closed 3D cloth mesh (metres, Y-up)."""

from __future__ import annotations

from typing import Any

import numpy as np

REST_LENGTH_SCHEMA = "ashrium.rest_length.v1"


def _as_float_list(value: Any, label: str) -> list[float]:
    if not isinstance(value, list) or len(value) == 0:
        raise RuntimeError(f"{label} must be a non-empty list.")
    out: list[float] = []
    for entry in value:
        if not isinstance(entry, (int, float)):
            raise RuntimeError(f"{label} must contain finite numbers.")
        number = float(entry)
        if not np.isfinite(number):
            raise RuntimeError(f"{label} must contain finite numbers.")
        out.append(number)
    return out


def parse_rest_length_mesh(payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("schema") != REST_LENGTH_SCHEMA:
        raise RuntimeError(f"garment_rest_mesh.schema must be {REST_LENGTH_SCHEMA}.")

    category = payload.get("category")
    if category not in {"tee", "pant", "dress", "outerwear", "other"}:
        raise RuntimeError("garment_rest_mesh.category is invalid.")

    rows = int(payload.get("rows", 0))
    cols = int(payload.get("cols", 0))
    if rows < 2 or cols < 2:
        raise RuntimeError("garment_rest_mesh must have at least 2 rows and 2 columns.")

    vertices = _as_float_list(payload.get("vertices"), "garment_rest_mesh.vertices")
    if len(vertices) != rows * cols * 2:
        raise RuntimeError("garment_rest_mesh.vertices length does not match rows*cols*2.")

    return {
        "category": category,
        "rows": rows,
        "cols": cols,
        "vertices": vertices,
    }


def build_cloth_from_rest_mesh(
    rest: dict[str, Any],
    origin_y: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return (rest_positions Nx3 metres, triangle indices, pin_mask)."""

    rows = int(rest["rows"])
    cols = int(rest["cols"])
    source = np.asarray(rest["vertices"], dtype=np.float32)
    ring_columns = (cols - 1) * 4
    vertex_count = rows * ring_columns
    positions = np.zeros((vertex_count, 3), dtype=np.float32)
    pin_mask = np.zeros(vertex_count, dtype=np.bool_)

    for row in range(rows):
        source_row = row * cols
        quarter = 0.0
        for source_col in range(cols):
            quarter = max(quarter, float(source[(source_row + source_col) * 2]))
        radius = max((quarter * 2.0) / np.pi, 0.02)
        source_y = float(source[source_row * 2 + 1])
        for col in range(ring_columns):
            index = row * ring_columns + col
            angle = (col / ring_columns) * np.pi * 2.0
            positions[index, 0] = np.cos(angle) * radius
            positions[index, 1] = origin_y + source_y
            positions[index, 2] = np.sin(angle) * radius
            pin_mask[index] = row == rows - 1

    faces: list[int] = []
    for row in range(rows - 1):
        for col in range(ring_columns):
            a = row * ring_columns + col
            b = row * ring_columns + ((col + 1) % ring_columns)
            c = a + ring_columns
            d = b + ring_columns
            faces.extend((a, c, b, b, c, d))

    indices = np.asarray(faces, dtype=np.int32)
    if indices.size < 3:
        raise RuntimeError("Cloth mesh produced no triangles.")
    return positions, indices, pin_mask
