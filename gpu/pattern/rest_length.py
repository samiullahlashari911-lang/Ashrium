"""Sample instantiated GarmentCode 2D panels into ashrium.rest_length.v1."""

from __future__ import annotations

from typing import Any

import numpy as np

REST_LENGTH_SCHEMA = "ashrium.rest_length.v1"
GRID_ROWS = 9
GRID_COLS = 7
BODY_PANEL_TOKENS = ("ftorso", "btorso", "pant_f", "pant_b", "torso")


def _vertex_index(row: int, col: int) -> int:
    return row * GRID_COLS + col


def _grid_edges() -> list[list[int]]:
    edges: list[list[int]] = []

    def push(left: int, right: int) -> None:
        if left < right:
            edges.append([left, right])
        else:
            edges.append([right, left])

    for row in range(GRID_ROWS):
        for col in range(GRID_COLS):
            index = _vertex_index(row, col)
            if col + 1 < GRID_COLS:
                push(index, _vertex_index(row, col + 1))
            if row + 1 < GRID_ROWS:
                push(index, _vertex_index(row + 1, col))
            if row + 1 < GRID_ROWS and col + 1 < GRID_COLS:
                push(index, _vertex_index(row + 1, col + 1))
                push(_vertex_index(row, col + 1), _vertex_index(row + 1, col))
    return edges


GRID_EDGES = _grid_edges()


def rest_lengths_from_vertices(vertices: list[float]) -> list[float]:
    lengths: list[float] = []
    for left, right in GRID_EDGES:
        dx = vertices[left * 2] - vertices[right * 2]
        dy = vertices[left * 2 + 1] - vertices[right * 2 + 1]
        lengths.append(float(np.hypot(dx, dy)))
    return lengths


def place_grid(quarter_widths_m: list[float], length_m: float) -> list[float]:
    if len(quarter_widths_m) != GRID_ROWS:
        raise RuntimeError("quarter_widths_m must have GRID_ROWS samples.")
    vertices = [0.0] * (GRID_ROWS * GRID_COLS * 2)
    for row in range(GRID_ROWS):
        width = max(float(quarter_widths_m[row]), 0.02)
        y = (row / (GRID_ROWS - 1)) * length_m
        for col in range(GRID_COLS):
            index = _vertex_index(row, col) * 2
            vertices[index] = (col / (GRID_COLS - 1)) * width
            vertices[index + 1] = y
    return vertices


def to_rest_length_mesh(
    category: str,
    size_code: str,
    measurements: dict[str, float],
    quarter_widths_m: list[float],
) -> dict[str, Any]:
    length_m = max(float(measurements["lengthCm"]) / 100.0, 0.05)
    vertices = place_grid(quarter_widths_m, length_m)
    return {
        "schema": REST_LENGTH_SCHEMA,
        "category": category,
        "sizeCode": size_code,
        "measurements": {
            "chestCm": float(measurements["chestCm"]),
            "waistCm": float(measurements["waistCm"]),
            "hipCm": float(measurements["hipCm"]),
            "lengthCm": float(measurements["lengthCm"]),
        },
        "rows": GRID_ROWS,
        "cols": GRID_COLS,
        "vertices": vertices,
        "edges": [list(edge) for edge in GRID_EDGES],
        "restLengths": rest_lengths_from_vertices(vertices),
    }


def is_body_panel(panel: Any) -> bool:
    name = str(getattr(panel, "name", "")).lower()
    label = str(getattr(panel, "label", "")).lower()
    if label in {"body", "leg"}:
        return True
    return any(token in name for token in BODY_PANEL_TOKENS)


def collect_body_panels(component: Any) -> list[Any]:
    from pygarment.garmentcode.panel import Panel

    seen: set[int] = set()
    panels: list[Any] = []

    def walk(node: Any) -> None:
        identity = id(node)
        if identity in seen:
            return
        seen.add(identity)
        if isinstance(node, Panel) and is_body_panel(node):
            panels.append(node)
        getter = getattr(node, "_get_subcomponents", None)
        if callable(getter):
            for child in getter():
                walk(child)

    walk(component)
    return panels


def _panel_width_at_world_y(panel: Any, world_y: float) -> float:
    from pygarment.garmentcode.edge import EdgeSequence

    if len(panel.edges) == 0:
        return 0.0
    lin_edges = EdgeSequence([edge.linearize() for edge in panel.edges])
    verts_2d = np.asarray(lin_edges.verts(), dtype=np.float64)
    if verts_2d.size < 4:
        return 0.0
    world = np.asarray([panel.point_to_3D(vertex) for vertex in verts_2d], dtype=np.float64)
    xs: list[float] = []
    count = verts_2d.shape[0]
    for index in range(count):
        nxt = (index + 1) % count
        y0 = float(world[index, 1])
        y1 = float(world[nxt, 1])
        x0 = float(verts_2d[index, 0])
        x1 = float(verts_2d[nxt, 0])
        if abs(y1 - y0) < 1e-8:
            if abs(y0 - world_y) < 0.35:
                xs.extend((x0, x1))
            continue
        t = (world_y - y0) / (y1 - y0)
        if 0.0 <= t <= 1.0:
            xs.append(x0 + t * (x1 - x0))
    if len(xs) < 2:
        return 0.0
    return float(abs(max(xs) - min(xs)))


def world_y_span(panels: list[Any]) -> tuple[float, float]:
    ymin = float("inf")
    ymax = float("-inf")
    for panel in panels:
        low, high = panel.bbox3D()
        ymin = min(ymin, float(low[1]))
        ymax = max(ymax, float(high[1]))
    if not np.isfinite(ymin) or not np.isfinite(ymax) or ymax - ymin < 1.0:
        raise RuntimeError("Instantiated GarmentCode pattern has no usable 2D length.")
    return ymin, ymax


def girth_cm_at_world_y(panels: list[Any], world_y: float) -> float:
    return float(sum(_panel_width_at_world_y(panel, world_y) for panel in panels))


def sample_quarter_widths_m(
    panels: list[Any],
    category: str,
) -> tuple[list[float], dict[str, float]]:
    ymin, ymax = world_y_span(panels)
    span = ymax - ymin
    widths_m: list[float] = []
    for row in range(GRID_ROWS):
        t = row / (GRID_ROWS - 1)
        world_y = ymin + t * span
        girth_cm = max(girth_cm_at_world_y(panels, world_y), 8.0)
        widths_m.append((girth_cm / 100.0) / 4.0)

    def station(t: float) -> float:
        return girth_cm_at_world_y(panels, ymin + t * span)

    if category == "pant":
        pattern_girths = {
            "chestCm": station(0.7),
            "waistCm": station(0.92),
            "hipCm": station(0.7),
            "lengthCm": span,
        }
    else:
        pattern_girths = {
            "chestCm": station(0.78),
            "waistCm": station(0.42),
            "hipCm": station(0.18),
            "lengthCm": span,
        }
    return widths_m, pattern_girths
