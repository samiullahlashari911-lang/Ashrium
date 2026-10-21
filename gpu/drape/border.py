"""The body as a hard border for the garment (metres, Y-up).

Newton collides the cloth with the LOD 3 collider, which sits slightly inside
the LOD 1 body the shopper sees. Two guards keep the drawn body from showing
through: the collider is inflated until it covers LOD 1, and after the drape
every garment vertex is checked against the exact LOD 1 surface (closest point
on a triangle, not the nearest vertex) and moved out to BORDER_GAP_M.
"""

from __future__ import annotations

from typing import Any

import numpy as np

BORDER_GAP_M = 0.003
MAX_INFLATE_M = 0.012
NEIGHBOURS = 8
INFLATE_ROUNDS = 4
# Post-border relaxation: edges past RELAX_LIMIT x pattern length are pulled to
# RELAX_TARGET x (healthy seam edges reach ~2.2x and are left alone; sewn.py fails > 3x).
RELAX_LIMIT = 2.5
RELAX_TARGET = 1.3
RELAX_ROUNDS = 80
# A point held against the body by the border moves this share of a free point's correction.
PINNED_SHARE = 0.2


def body_tree(vertices: np.ndarray) -> Any:
    """A KD-tree over the body for callers that query it many times; None without scipy."""
    try:
        from scipy.spatial import cKDTree
    except ImportError:
        return None
    return cKDTree(vertices)


def nearest_vertices(points: np.ndarray, vertices: np.ndarray, k: int = 1, tree: Any = None) -> np.ndarray:
    """Indices (n, k) of the k nearest vertices. scipy's KD-tree on the GPU image."""
    if tree is not None:
        _distance, index = tree.query(points, k=k)
        return np.asarray(index, dtype=np.int64).reshape(points.shape[0], k)
    try:
        from scipy.spatial import cKDTree
    except ImportError:  # local tests only; the Modal image ships scipy
        out = np.empty((points.shape[0], k), dtype=np.int64)
        for start in range(0, points.shape[0], 256):
            chunk = points[start:start + 256]
            d2 = ((chunk[:, None, :] - vertices[None, :, :]) ** 2).sum(axis=2)
            out[start:start + 256] = np.argsort(d2, axis=1)[:, :k]
        return out
    _distance, index = cKDTree(vertices).query(points, k=k)
    return np.asarray(index, dtype=np.int64).reshape(points.shape[0], k)


def vertex_faces(faces: np.ndarray, vertex_count: int, width: int = 12) -> np.ndarray:
    """(vertex_count, width) incident face ids, -1 padded."""
    table = np.full((vertex_count, width), -1, dtype=np.int64)
    fill = np.zeros(vertex_count, dtype=np.int64)
    for face_index, face in enumerate(faces):
        for vertex in face:
            slot = fill[vertex]
            if slot < width:
                table[vertex, slot] = face_index
                fill[vertex] = slot + 1
    return table


def _closest_on_triangles(p: np.ndarray, a: np.ndarray, b: np.ndarray, c: np.ndarray) -> np.ndarray:
    """Closest points on triangles (a, b, c) to p, all (m, 3). Ericson, Real-Time Collision Detection 5.1.5."""
    ab = b - a
    ac = c - a
    ap = p - a
    d1 = np.einsum("ij,ij->i", ab, ap)
    d2 = np.einsum("ij,ij->i", ac, ap)
    bp = p - b
    d3 = np.einsum("ij,ij->i", ab, bp)
    d4 = np.einsum("ij,ij->i", ac, bp)
    cp = p - c
    d5 = np.einsum("ij,ij->i", ab, cp)
    d6 = np.einsum("ij,ij->i", ac, cp)
    va = d3 * d6 - d5 * d4
    vb = d5 * d2 - d1 * d6
    vc = d1 * d4 - d3 * d2
    denom = np.maximum(va + vb + vc, 1e-30)
    v = vb / denom
    w = vc / denom
    out = a + ab * v[:, None] + ac * w[:, None]

    def put(mask: np.ndarray, value: np.ndarray) -> None:
        out[mask] = value[mask]

    with np.errstate(divide="ignore", invalid="ignore"):
        # Edge regions, then vertex regions (vertex regions win).
        mask = (va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0)
        t = np.clip((d4 - d3) / np.where(mask, (d4 - d3) + (d5 - d6), 1.0), 0, 1)
        put(mask, b + (c - b) * t[:, None])
        mask = (vb <= 0) & (d2 >= 0) & (d6 <= 0)
        t = np.clip(d2 / np.where(mask, d2 - d6, 1.0), 0, 1)
        put(mask, a + ac * t[:, None])
        mask = (vc <= 0) & (d1 >= 0) & (d3 <= 0)
        t = np.clip(d1 / np.where(mask, d1 - d3, 1.0), 0, 1)
        put(mask, a + ab * t[:, None])
    put((d6 >= 0) & (d5 <= d6), c)
    put((d3 >= 0) & (d4 <= d3), b)
    put((d1 <= 0) & (d2 <= 0), a)
    return out


def signed_distance_to_mesh(
    points: np.ndarray,
    vertices: np.ndarray,
    faces: np.ndarray,
    incident: np.ndarray | None = None,
    tree: Any = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Exact-ish signed distance (outside > 0) and the closest surface point.

    Candidates are the faces around the NEIGHBOURS nearest vertices; the sign
    comes from the winner's face normal (the MHR mesh winds outward).
    """
    if incident is None:
        incident = vertex_faces(faces, vertices.shape[0])
    near = nearest_vertices(points, vertices, NEIGHBOURS, tree)
    candidates = incident[near].reshape(points.shape[0], -1)
    best_distance = np.full(points.shape[0], np.inf)
    best_point = np.zeros_like(points)
    best_face = np.zeros(points.shape[0], dtype=np.int64)
    for column in range(candidates.shape[1]):
        face_ids = candidates[:, column]
        valid = face_ids >= 0
        if not valid.any():
            continue
        tri = faces[np.where(valid, face_ids, 0)]
        closest = _closest_on_triangles(points, vertices[tri[:, 0]], vertices[tri[:, 1]], vertices[tri[:, 2]])
        distance = np.linalg.norm(points - closest, axis=1)
        better = valid & (distance < best_distance)
        best_distance[better] = distance[better]
        best_point[better] = closest[better]
        best_face[better] = face_ids[better]
    tri = faces[best_face]
    normal = np.cross(vertices[tri[:, 1]] - vertices[tri[:, 0]], vertices[tri[:, 2]] - vertices[tri[:, 0]])
    side = np.einsum("ij,ij->i", points - best_point, normal)
    return np.where(side >= 0, best_distance, -best_distance), best_point


def enforce_border(
    points: np.ndarray,
    vertices: np.ndarray,
    faces: np.ndarray,
    gap_m: float = BORDER_GAP_M,
    incident: np.ndarray | None = None,
    normals: np.ndarray | None = None,
    tree: Any = None,
) -> tuple[np.ndarray, int]:
    """Move every point closer than gap_m to (or inside) the body out to gap_m.

    The direction is from the exact closest surface point (flipped for points
    inside); a nearest-vertex normal left a few points 2 mm inside. Re-checks
    until clear.
    """
    out, moved = _border(points, vertices, faces, gap_m, incident, normals, tree, 3)
    return out, int(moved.sum())


def _border(
    points: np.ndarray,
    vertices: np.ndarray,
    faces: np.ndarray,
    gap_m: float,
    incident: np.ndarray | None,
    normals: np.ndarray | None,
    tree: Any,
    rounds: int,
) -> tuple[np.ndarray, np.ndarray]:
    """enforce_border, returning which points it moved."""
    if incident is None:
        incident = vertex_faces(faces, vertices.shape[0])
    if normals is None:
        normals = _vertex_normals(vertices, faces)
    out = points.copy()
    moved = np.zeros(points.shape[0], dtype=bool)
    for _round in range(rounds):
        distance, surface = signed_distance_to_mesh(out, vertices, faces, incident, tree)
        offending = distance < gap_m * 0.98
        if not offending.any():
            break
        offset = (out[offending] - surface[offending]) * np.sign(distance[offending])[:, None]
        length = np.linalg.norm(offset, axis=1, keepdims=True)
        fallback = normals[nearest_vertices(surface[offending], vertices, 1, tree)[:, 0]]
        direction = np.where(length > 1e-6, offset / np.maximum(length, 1e-12), fallback)
        out[offending] = surface[offending] + direction * gap_m
        moved |= offending
    return out, moved


def relax_overstretched(
    points: np.ndarray,
    triangles: np.ndarray,
    rest_lengths: np.ndarray,
    vertices: np.ndarray,
    faces: np.ndarray,
    limit: float = RELAX_LIMIT,
    rounds: int = RELAX_ROUNDS,
) -> tuple[np.ndarray, int]:
    """Pull edges stretched past `limit` x their pattern length back, staying outside the body.

    The border moves a sunk point straight out to the surface; its neighbours
    stay put, so one edge can end several times its length (a long hem on a
    short shopper sinks into the feet: 4-5x edges with p99 1.02-1.10). Each
    round shortens every such edge to RELAX_TARGET x rest (Jacobi averaged)
    and re-borders the points it touched. A point the border holds against
    the body moves PINNED_SHARE as far as a free one, so the hanging cloth
    comes to it instead of both fighting the border. A real tear that this
    cannot close stays for the quality check. `rest_lengths` is (T, 3) for
    the corner pairs (0,1), (1,2), (2,0). Returns the points and how many moved.
    """
    edges = np.concatenate([triangles[:, [0, 1]], triangles[:, [1, 2]], triangles[:, [2, 0]]])
    rest = np.concatenate([rest_lengths[:, 0], rest_lengths[:, 1], rest_lengths[:, 2]])
    out = points.copy()
    touched_all = np.zeros(points.shape[0], dtype=bool)
    pinned = np.zeros(points.shape[0], dtype=bool)
    incident: np.ndarray | None = None
    normals: np.ndarray | None = None
    tree: Any = None
    for _round in range(rounds):
        span = out[edges[:, 1]] - out[edges[:, 0]]
        drawn = np.linalg.norm(span, axis=1)
        bad = drawn > limit * np.maximum(rest, 1e-6)
        if not bad.any():
            break
        if incident is None:
            # Built once, only for a drape that needs relaxing.
            incident = vertex_faces(faces, vertices.shape[0])
            normals = _vertex_normals(vertices, faces)
            tree = body_tree(vertices)
            ends = np.unique(edges[bad])
            _held, near = _border(out[ends], vertices, faces, BORDER_GAP_M * 1.5, incident, normals, tree, 1)
            pinned[ends] = near
        a, b = edges[bad, 0], edges[bad, 1]
        weight_a = np.where(pinned[a], PINNED_SHARE, 1.0)
        weight_b = np.where(pinned[b], PINNED_SHARE, 1.0)
        excess = (drawn[bad] - RELAX_TARGET * rest[bad]) / np.maximum(drawn[bad], 1e-12)
        share = excess / (weight_a + weight_b)
        delta = np.zeros_like(out)
        count = np.zeros(out.shape[0])
        np.add.at(delta, a, span[bad] * (share * weight_a)[:, None])
        np.add.at(delta, b, -span[bad] * (share * weight_b)[:, None])
        np.add.at(count, a, 1.0)
        np.add.at(count, b, 1.0)
        touched = count > 0
        out[touched] += delta[touched] / count[touched, None]
        out[touched], held = _border(out[touched], vertices, faces, BORDER_GAP_M, incident, normals, tree, 1)
        pinned[touched] = held
        touched_all |= touched
    if touched_all.any():
        out[touched_all], _moved = enforce_border(
            out[touched_all], vertices, faces, incident=incident, normals=normals, tree=tree
        )
    return out, int(touched_all.sum())


def _vertex_normals(vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
    corners = vertices[faces]
    face_normals = np.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0])
    normals = np.zeros_like(vertices)
    for k in range(3):
        np.add.at(normals, faces[:, k], face_normals)
    return normals / np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)


def inflate_collider(
    collider: np.ndarray,
    collider_faces: np.ndarray,
    body: np.ndarray,
    body_faces: np.ndarray,
) -> tuple[np.ndarray, float]:
    """Push each LOD 3 collider vertex out just enough to cover the LOD 1 body near it.

    Clustering shrinks convex regions (up to ~9 mm at the shoulders) but not
    flat ones; a uniform inflation would float the cloth off the skin
    everywhere. Returns the inflated collider and the largest push (m).
    """
    normals = _vertex_normals(collider, collider_faces)
    incident = vertex_faces(collider_faces, collider.shape[0])
    inflated = collider + normals * 0.001
    for _round in range(INFLATE_ROUNDS):
        distance, surface = signed_distance_to_mesh(body, inflated, collider_faces, incident)
        # LOD 1 vertices outside the collider are where the drawn body would poke through.
        poking = distance > 0.0
        if not poking.any():
            break
        # Push the corners of the collider triangle each poking vertex is closest to.
        nearest_face = _nearest_face(surface[poking], inflated, collider_faces, incident)
        push = np.zeros(collider.shape[0])
        for corner in range(3):
            np.maximum.at(push, collider_faces[nearest_face, corner], distance[poking] + 0.0005)
        inflated = inflated + normals * push[:, None]
    total = np.linalg.norm(inflated - collider, axis=1)
    limit = total > MAX_INFLATE_M
    inflated[limit] = collider[limit] + normals[limit] * MAX_INFLATE_M
    return inflated, float(np.minimum(total, MAX_INFLATE_M).max())


def _nearest_face(points: np.ndarray, vertices: np.ndarray, faces: np.ndarray, incident: np.ndarray) -> np.ndarray:
    near = nearest_vertices(points, vertices, NEIGHBOURS)
    candidates = incident[near].reshape(points.shape[0], -1)
    best = np.full(points.shape[0], np.inf)
    best_face = np.zeros(points.shape[0], dtype=np.int64)
    for column in range(candidates.shape[1]):
        face_ids = candidates[:, column]
        valid = face_ids >= 0
        tri = faces[np.where(valid, face_ids, 0)]
        closest = _closest_on_triangles(points, vertices[tri[:, 0]], vertices[tri[:, 1]], vertices[tri[:, 2]])
        distance = np.linalg.norm(points - closest, axis=1)
        better = valid & (distance < best)
        best[better] = distance[better]
        best_face[better] = face_ids[better]
    return best_face
