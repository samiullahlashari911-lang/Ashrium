"""Triangulate a 2D sewing-pattern panel (pure numpy; CGAL/libigl are not in the image).

Ear clipping gives a triangulation that keeps every boundary sample; Lawson
flips make it constrained-Delaunay (boundary edges are never flipped); centroid
insertion refines it until no triangle edge is longer than `max_edge`. The
boundary is never split, so stitched edges keep the sample counts they were
paired with.
"""

from __future__ import annotations

import numpy as np

_EPS = 1e-12


def _signed_area(points: np.ndarray) -> float:
    x = points[:, 0]
    y = points[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(np.roll(x, -1), y))


def _orient(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    return float((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))


def _in_circle(a: np.ndarray, b: np.ndarray, c: np.ndarray, d: np.ndarray) -> float:
    """> 0 when d is inside the circumcircle of the CCW triangle (a, b, c)."""
    rows = []
    for p in (a, b, c):
        dx = p[0] - d[0]
        dy = p[1] - d[1]
        rows.append((dx, dy, dx * dx + dy * dy))
    return float(np.linalg.det(np.asarray(rows, dtype=np.float64)))


def _point_in_triangle(p: np.ndarray, a: np.ndarray, b: np.ndarray, c: np.ndarray, scale: float) -> bool:
    """Inside or on the edge of the CCW triangle (on-edge blocks the ear: no T-junctions)."""
    tol = -1e-9 * scale * scale
    return _orient(a, b, p) >= tol and _orient(b, c, p) >= tol and _orient(c, a, p) >= tol


def _ear_clip(points: np.ndarray) -> list[tuple[int, int, int]]:
    """Triangulate a simple CCW polygon (indices into points)."""
    scale = float(np.max(np.ptp(points, axis=0))) or 1.0
    remaining = list(range(points.shape[0]))
    triangles: list[tuple[int, int, int]] = []
    guard = 0
    while len(remaining) > 3:
        guard += 1
        if guard > 4 * points.shape[0] * points.shape[0]:
            raise RuntimeError("Panel outline could not be triangulated (self-intersecting?).")
        count = len(remaining)
        best: tuple[float, int] | None = None
        for position in range(count):
            i_prev = remaining[position - 1]
            i_cur = remaining[position]
            i_next = remaining[(position + 1) % count]
            a, b, c = points[i_prev], points[i_cur], points[i_next]
            if _orient(a, b, c) <= 1e-10 * scale * scale:
                continue
            blocked = False
            for other in remaining:
                if other in (i_prev, i_cur, i_next):
                    continue
                if _point_in_triangle(points[other], a, b, c, scale):
                    blocked = True
                    break
            if blocked:
                continue
            # Prefer the fattest ear: fewer slivers for the flips to repair.
            ab = np.linalg.norm(b - a)
            bc = np.linalg.norm(c - b)
            ca = np.linalg.norm(a - c)
            quality = _orient(a, b, c) / max(ab * ab + bc * bc + ca * ca, _EPS)
            if best is None or quality > best[0]:
                best = (quality, position)
        if best is None:
            # Only collinear runs are left: drop a collinear middle vertex (no area lost).
            for position in range(count):
                a = points[remaining[position - 1]]
                b = points[remaining[position]]
                c = points[remaining[(position + 1) % count]]
                if abs(_orient(a, b, c)) <= 1e-10 * scale * scale:
                    raise RuntimeError("Panel outline has a degenerate collinear spike.")
            raise RuntimeError("Panel outline has no ear (self-intersecting outline).")
        position = best[1]
        triangles.append(
            (remaining[position - 1], remaining[position], remaining[(position + 1) % count])
        )
        del remaining[position]
    a, b, c = (points[index] for index in remaining)
    if _orient(a, b, c) > 0:
        triangles.append((remaining[0], remaining[1], remaining[2]))
    return triangles


class _Mesh:
    """Triangle soup with edge adjacency for constrained Lawson flips."""

    def __init__(self, points: list[np.ndarray], boundary: set[tuple[int, int]]) -> None:
        self.points = points
        self.boundary = boundary
        self.triangles: list[tuple[int, int, int] | None] = []
        self.edges: dict[tuple[int, int], set[int]] = {}

    @staticmethod
    def key(a: int, b: int) -> tuple[int, int]:
        return (a, b) if a < b else (b, a)

    def add(self, tri: tuple[int, int, int]) -> int:
        index = len(self.triangles)
        self.triangles.append(tri)
        for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
            self.edges.setdefault(self.key(a, b), set()).add(index)
        return index

    def remove(self, index: int) -> None:
        tri = self.triangles[index]
        if tri is None:
            return
        for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
            owners = self.edges.get(self.key(a, b))
            if owners is not None:
                owners.discard(index)
                if not owners:
                    del self.edges[self.key(a, b)]
        self.triangles[index] = None

    def legalize(self, stack: list[tuple[int, int]]) -> None:
        guard = 0
        while stack:
            guard += 1
            if guard > 200_000:
                raise RuntimeError("Panel triangulation did not converge.")
            a, b = stack.pop()
            edge = self.key(a, b)
            if edge in self.boundary:
                continue
            owners = self.edges.get(edge)
            if owners is None or len(owners) != 2:
                continue
            t1, t2 = tuple(owners)
            tri1 = self.triangles[t1]
            tri2 = self.triangles[t2]
            assert tri1 is not None and tri2 is not None
            # Rotate tri1 so it reads (p, q, c) with p->q the shared edge in CCW order.
            p, q, c = _rotate_to_edge(tri1, edge)
            d = next(v for v in tri2 if v not in (p, q))
            P = self.points
            if _in_circle(P[p], P[q], P[c], P[d]) <= 1e-12:
                continue
            # Quad p, d, q, c is CCW; only flip when both new triangles keep area.
            if _orient(P[p], P[d], P[c]) <= 0 or _orient(P[d], P[q], P[c]) <= 0:
                continue
            self.remove(t1)
            self.remove(t2)
            self.add((p, d, c))
            self.add((d, q, c))
            stack.extend(((p, d), (d, q), (q, c), (c, p)))

    def split(self, index: int, point: np.ndarray) -> None:
        tri = self.triangles[index]
        assert tri is not None
        new_index = len(self.points)
        self.points.append(point)
        a, b, c = tri
        self.remove(index)
        self.add((a, b, new_index))
        self.add((b, c, new_index))
        self.add((c, a, new_index))
        self.legalize([(a, b), (b, c), (c, a)])

    def live(self) -> list[tuple[int, int, int]]:
        return [tri for tri in self.triangles if tri is not None]


def _rotate_to_edge(tri: tuple[int, int, int], edge: tuple[int, int]) -> tuple[int, int, int]:
    for shift in range(3):
        p, q, c = tri[shift], tri[(shift + 1) % 3], tri[(shift + 2) % 3]
        if {p, q} == set(edge):
            return p, q, c
    raise RuntimeError("Edge is not on the triangle.")


def triangulate_panel(
    boundary: np.ndarray,
    max_edge: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Triangulate a closed outline (n x 2, no repeated closing point).

    Returns (points, triangles). The first n points are the boundary, unchanged
    and in order; triangles wind the same way as the outline.
    """

    outline = np.asarray(boundary, dtype=np.float64)
    if outline.ndim != 2 or outline.shape[1] != 2 or outline.shape[0] < 3:
        raise RuntimeError("Panel outline needs at least three 2D points.")
    if not np.isfinite(outline).all():
        raise RuntimeError("Panel outline has non-finite points.")
    if max_edge <= 0:
        raise RuntimeError("max_edge must be positive.")

    count = outline.shape[0]
    ccw = _signed_area(outline) > 0
    order = list(range(count)) if ccw else list(range(count))[::-1]
    working = outline[order]

    boundary_edges = {
        _Mesh.key(order[i], order[(i + 1) % count]) for i in range(count)
    }
    mesh = _Mesh([outline[i] for i in range(count)], boundary_edges)
    for tri in _ear_clip(working):
        # Original indices, CCW geometry (the flips assume CCW).
        mesh.add((order[tri[0]], order[tri[1]], order[tri[2]]))
    mesh.legalize([edge for edge in mesh.edges])

    limit_sq = max_edge * max_edge
    for _round in range(64):
        P = mesh.points
        long_triangles = []
        for index, tri in enumerate(mesh.triangles):
            if tri is None:
                continue
            a, b, c = (P[v] for v in tri)
            longest = max(
                float(np.dot(a - b, a - b)), float(np.dot(b - c, b - c)), float(np.dot(c - a, c - a))
            )
            if longest > limit_sq:
                long_triangles.append((longest, index))
        if not long_triangles:
            break
        long_triangles.sort(reverse=True)
        for _longest, index in long_triangles:
            tri = mesh.triangles[index]
            if tri is None:
                continue
            a, b, c = (mesh.points[v] for v in tri)
            # Edges touching the boundary are already at the sample spacing; a
            # triangle is long only through its interior extent.
            mesh.split(index, (a + b + c) / 3.0)
    else:
        raise RuntimeError("Panel refinement did not reach the target edge length.")

    points = np.asarray(mesh.points, dtype=np.float64)
    triangles = np.asarray(mesh.live(), dtype=np.int64)
    if not ccw:
        triangles = triangles[:, ::-1]
    return points, triangles


def boundary_edges_present(triangles: np.ndarray, count: int) -> bool:
    """Every consecutive outline pair is a triangle edge (a closed, unsplit boundary)."""
    present: set[tuple[int, int]] = set()
    for a, b, c in triangles:
        for u, v in ((a, b), (b, c), (c, a)):
            present.add((min(int(u), int(v)), max(int(u), int(v))))
    return all(
        (min(i, (i + 1) % count), max(i, (i + 1) % count)) in present for i in range(count)
    )
