"""Sew instantiated GarmentCode panels into a 3D garment mesh (ashrium.garment_mesh.v1).

Each panel's real edges (lines, arcs, Béziers) are sampled at ~SPACING_CM,
triangulated in 2D, and placed in 3D with the panel's own GarmentCode
rotation/translation. Stitched edges get the same sample count so their
vertices pair one-to-one; the drape welds them. UVs are the 2D panel
coordinates in metres: the solver's rest shape and the product texture space.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np

from pattern.mesher import triangulate_panel

GARMENT_MESH_SCHEMA = "ashrium.garment_mesh.v1"
SPACING_CM = 1.5
# Interior triangles may be a little longer than the boundary spacing.
MAX_EDGE_FACTOR = 1.35
MIN_EDGE_SAMPLES = 2

EdgeKey = tuple[str, int]


@dataclass
class PanelOutline:
    """One panel: its edges sampled start->end (cm, panel 2D frame) and 3D placement."""

    name: str
    edges: list[np.ndarray]
    rotation: np.ndarray
    translation: np.ndarray


def edge_sample_counts(
    lengths_cm: dict[EdgeKey, float],
    stitches: list[tuple[EdgeKey, EdgeKey]],
    spacing_cm: float = SPACING_CM,
) -> dict[EdgeKey, int]:
    """Samples per edge (endpoints included); both sides of a stitch share the larger count."""
    counts = {
        key: max(MIN_EDGE_SAMPLES, math.ceil(length / spacing_cm) + 1)
        for key, length in lengths_cm.items()
    }
    stitched: set[EdgeKey] = set()
    for left, right in stitches:
        for key in (left, right):
            if key not in counts:
                raise RuntimeError(f"Stitch references unknown edge {key}.")
            if key in stitched:
                raise RuntimeError(f"Edge {key} is stitched more than once.")
            stitched.add(key)
        shared = max(counts[left], counts[right])
        counts[left] = shared
        counts[right] = shared
    return counts


def _panel_boundary(outline: PanelOutline) -> tuple[np.ndarray, list[list[int]]]:
    """Closed outline points plus, per edge, its boundary indices (start..end, wrapping)."""
    points: list[np.ndarray] = []
    ranges: list[list[int]] = []
    edge_count = len(outline.edges)
    if edge_count < 2:
        raise RuntimeError(f"Panel {outline.name} has fewer than two edges.")
    for index, samples in enumerate(outline.edges):
        nxt = outline.edges[(index + 1) % edge_count]
        gap = float(np.linalg.norm(samples[-1] - nxt[0]))
        if gap > 1e-3:
            raise RuntimeError(f"Panel {outline.name} edges do not form a loop (gap {gap:.4f} cm).")
        start = len(points)
        points.extend(samples[:-1])
        ranges.append(list(range(start, start + samples.shape[0])))
    total = len(points)
    for edge_range in ranges:
        edge_range[-1] = edge_range[-1] % total
    return np.asarray(points, dtype=np.float64), ranges


def sew_outlines(
    outlines: list[PanelOutline],
    stitches: list[tuple[EdgeKey, EdgeKey]],
    spacing_cm: float = SPACING_CM,
) -> dict[str, Any]:
    """Triangulate, place, and pair stitched vertices. Output units are metres."""
    if not outlines:
        raise RuntimeError("Garment has no panels to sew.")

    uv_parts: list[np.ndarray] = []
    position_parts: list[np.ndarray] = []
    triangle_parts: list[np.ndarray] = []
    panel_of_vertex: list[np.ndarray] = []
    edge_vertices: dict[EdgeKey, np.ndarray] = {}
    offset = 0

    for panel_index, outline in enumerate(outlines):
        boundary, ranges = _panel_boundary(outline)
        points_2d, triangles = triangulate_panel(boundary, spacing_cm * MAX_EDGE_FACTOR)
        placed = points_2d @ outline.rotation[:, :2].T + outline.translation[None, :]
        uv_parts.append(points_2d / 100.0)
        position_parts.append(placed / 100.0)
        triangle_parts.append(triangles + offset)
        panel_of_vertex.append(np.full(points_2d.shape[0], panel_index, dtype=np.int32))
        for edge_index, edge_range in enumerate(ranges):
            edge_vertices[(outline.name, edge_index)] = np.asarray(edge_range, dtype=np.int64) + offset
        offset += points_2d.shape[0]

    positions = np.concatenate(position_parts)
    pairs: list[tuple[int, int]] = []
    for left, right in stitches:
        if left not in edge_vertices or right not in edge_vertices:
            raise RuntimeError(f"Stitch {left}-{right} references an edge that was not sewn.")
        a = edge_vertices[left]
        b = edge_vertices[right]
        if a.shape[0] != b.shape[0]:
            raise RuntimeError(f"Stitch {left}-{right} sides have different sample counts.")
        # Stitch direction from 3D placement: the panels already face each other.
        forward = float(np.linalg.norm(positions[a] - positions[b], axis=1).sum())
        backward = float(np.linalg.norm(positions[a] - positions[b[::-1]], axis=1).sum())
        if backward < forward:
            b = b[::-1]
        pairs.extend((int(u), int(v)) for u, v in zip(a, b) if u != v)

    return {
        "schema": GARMENT_MESH_SCHEMA,
        "units": "m",
        "up": "y",
        "panels": [outline.name for outline in outlines],
        # 0.01 mm: plenty for cloth, and the stored garment stays a few MB at most.
        "positions": np.round(positions, 5).reshape(-1).tolist(),
        "uv": np.round(np.concatenate(uv_parts), 5).reshape(-1).tolist(),
        "triangles": np.concatenate(triangle_parts).astype(np.int32).reshape(-1).tolist(),
        "panel_of_vertex": np.concatenate(panel_of_vertex).tolist(),
        "stitches": [list(pair) for pair in pairs],
        "vertex_count": int(positions.shape[0]),
    }


def weld(stitches: list[list[int]] | np.ndarray, vertex_count: int) -> np.ndarray:
    """Map every vertex to a welded id (union-find over stitch pairs), ids compacted 0..k-1."""
    parent = np.arange(vertex_count, dtype=np.int64)

    def find(x: int) -> int:
        root = x
        while parent[root] != root:
            root = int(parent[root])
        while parent[x] != root:
            parent[x], x = root, int(parent[x])
        return root

    for a, b in np.asarray(stitches, dtype=np.int64).reshape(-1, 2):
        ra, rb = find(int(a)), find(int(b))
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)
    roots = np.asarray([find(i) for i in range(vertex_count)], dtype=np.int64)
    _unique, compact = np.unique(roots, return_inverse=True)
    return compact.astype(np.int64)


# --- GarmentCode adapter (runs only where GarmentCode is importable) ---------------


def _edge_points(edge: Any, count: int) -> np.ndarray:
    curve = edge.as_curve()
    kind = type(curve).__name__
    if kind in ("QuadraticBezier", "CubicBezier"):
        total = float(curve.length())
        ts = [curve.ilength(s) if 0.0 < s < total else s / max(total, 1e-9)
              for s in np.linspace(0.0, total, count)]
    else:
        ts = np.linspace(0.0, 1.0, count)
    samples = np.asarray([[curve.point(t).real, curve.point(t).imag] for t in ts], dtype=np.float64)
    start = np.asarray(edge.start, dtype=np.float64)
    end = np.asarray(edge.end, dtype=np.float64)
    if np.linalg.norm(samples[0] - start) > 1e-3 or np.linalg.norm(samples[-1] - end) > 1e-3:
        raise RuntimeError("GarmentCode edge curve does not run start->end.")
    samples[0] = start
    samples[-1] = end
    return samples


def collect_panels(component: Any) -> list[Any]:
    from pygarment.garmentcode.panel import Panel

    seen: set[int] = set()
    panels: list[Any] = []

    def walk(node: Any) -> None:
        if id(node) in seen:
            return
        seen.add(id(node))
        if isinstance(node, Panel):
            panels.append(node)
            return
        getter = getattr(node, "_get_subcomponents", None)
        if callable(getter):
            for child in getter():
                walk(child)

    walk(component)
    return panels


def sew_garment(garment: Any, spacing_cm: float = SPACING_CM) -> dict[str, Any]:
    """GarmentCode MetaGarment -> ashrium.garment_mesh.v1."""
    spec = garment.assembly()
    pattern = spec.pattern
    panels = {panel.name: panel for panel in collect_panels(garment)}
    # Sorted: GarmentCode collects sub-components in a set, so its order varies
    # run to run; a stable order keeps vertex ids (and caches) reproducible.
    names = sorted(pattern["panels"].keys())
    missing = [name for name in names if name not in panels]
    if missing:
        raise RuntimeError(f"Assembled panels missing from the component tree: {missing}")

    edge_lookup: dict[EdgeKey, Any] = {}
    lengths: dict[EdgeKey, float] = {}
    edge_index_of: dict[tuple[str, int], int] = {}
    for name in names:
        panel = panels[name]
        if len(panel.edges) != len(pattern["panels"][name]["edges"]):
            raise RuntimeError(f"Panel {name} edge count differs from its assembled spec.")
        for index, edge in enumerate(panel.edges):
            edge_index_of[(name, int(edge.geometric_id))] = index
            edge_lookup[(name, index)] = edge
            lengths[(name, index)] = float(edge.length())

    stitches: list[tuple[EdgeKey, EdgeKey]] = []
    for stitch in pattern["stitches"]:
        sides = [side for side in stitch if isinstance(side, dict)]
        if len(sides) != 2:
            raise RuntimeError(f"Unexpected GarmentCode stitch {stitch}.")
        keys = []
        for side in sides:
            geometric = (str(side["panel"]), int(side["edge"]))
            if geometric not in edge_index_of:
                raise RuntimeError(f"Stitch edge {geometric} not found on its panel.")
            keys.append((geometric[0], edge_index_of[geometric]))
        stitches.append((keys[0], keys[1]))

    counts = edge_sample_counts(lengths, stitches, spacing_cm)
    outlines: list[PanelOutline] = []
    for name in names:
        panel = panels[name]
        sampled = [_edge_points(edge_lookup[(name, index)], counts[(name, index)])
                   for index in range(len(panel.edges))]
        rotation = np.asarray(panel.rotation.as_matrix(), dtype=np.float64)
        translation = np.asarray(panel.translation, dtype=np.float64).reshape(3)
        outlines.append(PanelOutline(name=name, edges=sampled, rotation=rotation, translation=translation))

    mesh = sew_outlines(outlines, stitches, spacing_cm)
    mesh["spacing_cm"] = spacing_cm
    return mesh


def garment_openings_cm(mesh: dict[str, Any]) -> dict[str, Any]:
    """Rounds of the sewn garment's open edges, measured on the flat pattern (cm).

    Each boundary loop of the welded garment is one opening: the lowest is the
    hem, loops that touch a sleeve panel are sleeve openings, and the remaining
    torso loop is the neck. `neck_front_depth` drops from the neck's highest
    point to its lowest front point (GarmentCode placement, +z front).
    """
    uv = np.asarray(mesh["uv"], dtype=np.float64).reshape(-1, 2) * 100.0
    placed = np.asarray(mesh["positions"], dtype=np.float64).reshape(-1, 3) * 100.0
    triangles = np.asarray(mesh["triangles"], dtype=np.int64).reshape(-1, 3)
    panel_of_vertex = np.asarray(mesh["panel_of_vertex"], dtype=np.int64)
    names = list(mesh["panels"])
    welded = weld(mesh["stitches"], panel_of_vertex.shape[0])

    owners: dict[tuple[int, int], list[tuple[int, int]]] = {}
    for a, b, c in triangles:
        for u, v in ((a, b), (b, c), (c, a)):
            wu, wv = int(welded[u]), int(welded[v])
            owners.setdefault((min(wu, wv), max(wu, wv)), []).append((int(u), int(v)))
    boundary = {edge: pair[0] for edge, pair in owners.items() if len(pair) == 1}
    adjacency: dict[int, list[int]] = {}
    for a, b in boundary:
        adjacency.setdefault(a, []).append(b)
        adjacency.setdefault(b, []).append(a)

    loops = []
    seen: set[int] = set()
    for start in adjacency:
        if start in seen:
            continue
        loop = [start]
        seen.add(start)
        current = start
        while True:
            nxt = [n for n in adjacency[current] if n not in seen]
            if not nxt:
                break
            current = nxt[0]
            seen.add(current)
            loop.append(current)
        length = 0.0
        members: list[int] = []
        for i, w in enumerate(loop):
            edge = (min(w, loop[(i + 1) % len(loop)]), max(w, loop[(i + 1) % len(loop)]))
            if edge in boundary:
                u, v = boundary[edge]
                length += float(np.linalg.norm(uv[u] - uv[v]))
                members.extend((u, v))
        idx = np.unique(np.asarray(members, dtype=np.int64))
        sleeve = any("sleeve" in names[int(p)] for p in panel_of_vertex[idx])
        loops.append({"round": length, "vertices": idx, "sleeve": sleeve, "y": float(placed[idx, 1].mean())})

    body = sorted((loop for loop in loops if not loop["sleeve"]), key=lambda loop: loop["y"])
    if len(body) < 2:
        raise RuntimeError("Sewn garment has no separate hem and neck openings.")
    hem, neck = body[0], body[-1]
    neck_points = placed[neck["vertices"]]
    centre_x = float(np.median(neck_points[:, 0]))
    front = neck_points[(neck_points[:, 2] > np.median(neck_points[:, 2])) & (np.abs(neck_points[:, 0] - centre_x) < 3.0)]
    depth = float(neck_points[:, 1].max() - (front[:, 1].min() if front.size else neck_points[:, 1].min()))
    return {
        "hem_round": round(hem["round"], 1),
        "neck_round": round(neck["round"], 1),
        "neck_front_depth": round(depth, 1),
        "sleeve_rounds": [round(loop["round"], 1) for loop in loops if loop["sleeve"]],
    }
