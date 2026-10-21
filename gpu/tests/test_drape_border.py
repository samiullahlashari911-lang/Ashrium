"""The post-border relaxation (drape/border.py), on a synthetic body. No GPU."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np

COG_ROOT = Path(__file__).resolve().parents[1]
if str(COG_ROOT) not in sys.path:
    sys.path.insert(0, str(COG_ROOT))

from drape.border import (  # noqa: E402
    BORDER_GAP_M,
    RELAX_LIMIT,
    enforce_border,
    relax_overstretched,
    signed_distance_to_mesh,
)


def _box(half: float) -> tuple[np.ndarray, np.ndarray]:
    """A closed, outward-wound box (a stand-in for a foot), centred at the origin."""
    v = np.array([[x, y, z] for x in (-half, half) for y in (-half, half) for z in (-half, half)], dtype=np.float64)
    quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    faces = []
    for a, b, c, d in quads:
        faces += [(a, b, c), (a, c, d)]
    return v, np.array(faces, dtype=np.int64)


def _subdivide(v: np.ndarray, f: np.ndarray, times: int) -> tuple[np.ndarray, np.ndarray]:
    for _ in range(times):
        verts = list(map(tuple, v))
        index = {p: i for i, p in enumerate(verts)}
        out = []

        def mid(i: int, j: int) -> int:
            p = tuple((np.asarray(verts[i]) + np.asarray(verts[j])) / 2.0)
            if p not in index:
                index[p] = len(verts)
                verts.append(p)
            return index[p]

        for a, b, c in f:
            ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
            out += [(a, ab, ca), (ab, b, bc), (ca, bc, c), (ab, bc, ca)]
        v, f = np.array(verts), np.array(out, dtype=np.int64)
    return v, f


def _sheet(n: int, size: float, y: float) -> tuple[np.ndarray, np.ndarray]:
    xs = np.linspace(-size / 2, size / 2, n)
    pts = np.array([[x, y, z] for z in xs for x in xs], dtype=np.float64)
    tris = []
    for r in range(n - 1):
        for c in range(n - 1):
            i = r * n + c
            tris += [(i, i + 1, i + n), (i + 1, i + n + 1, i + n)]
    return pts, np.array(tris, dtype=np.int64)


def _lengths(points: np.ndarray, tris: np.ndarray) -> np.ndarray:
    return np.stack(
        [np.linalg.norm(points[tris[:, a]] - points[tris[:, b]], axis=1) for a, b in ((0, 1), (1, 2), (2, 0))], axis=1
    )


class RelaxTests(unittest.TestCase):
    def setUp(self) -> None:
        self.body, self.faces = _subdivide(*_box(0.04), 2)
        # A cloth sheet resting 2 cm over the box, one corner region sunk 2.5 cm into it.
        self.cloth, self.tris = _sheet(13, 0.12, 0.06)
        self.rest = _lengths(self.cloth, self.tris)
        sunk = self.cloth.copy()
        centre = np.argmin(np.linalg.norm(sunk[:, [0, 2]] - [0.02, 0.02], axis=1))
        sunk[centre, 1] = 0.015
        self.bordered, _ = enforce_border(sunk, self.body, self.faces)

    def test_the_border_alone_leaves_a_torn_edge(self) -> None:
        ratio = _lengths(self.bordered, self.tris) / self.rest
        self.assertGreater(ratio.max(), RELAX_LIMIT)

    def test_relaxation_closes_it_and_keeps_the_cloth_outside(self) -> None:
        relaxed, moved = relax_overstretched(self.bordered, self.tris, self.rest, self.body, self.faces)
        ratio = _lengths(relaxed, self.tris) / self.rest
        self.assertLessEqual(ratio.max(), RELAX_LIMIT + 1e-6)
        self.assertGreater(moved, 0)
        distance, _ = signed_distance_to_mesh(relaxed, self.body, self.faces)
        self.assertGreaterEqual(distance.min(), BORDER_GAP_M * 0.97)

    def test_a_healthy_drape_is_untouched(self) -> None:
        relaxed, moved = relax_overstretched(self.cloth, self.tris, self.rest, self.body, self.faces)
        self.assertEqual(moved, 0)
        np.testing.assert_array_equal(relaxed, self.cloth)


if __name__ == "__main__":
    unittest.main()
