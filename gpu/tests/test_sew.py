"""Sewing GarmentCode panels into a 3D garment mesh (pure numpy; no GarmentCode needed)."""

from __future__ import annotations

import unittest

import numpy as np

from pattern.mesher import boundary_edges_present, triangulate_panel
from drape.arrange import relax_flat_triangles, solver_rest_uv
from pattern.sew import PanelOutline, edge_sample_counts, sew_outlines, weld


def _resample(corners: list[tuple[float, float]], step: float) -> np.ndarray:
    points = []
    for index, start in enumerate(corners):
        a = np.asarray(start, dtype=np.float64)
        b = np.asarray(corners[(index + 1) % len(corners)], dtype=np.float64)
        count = max(1, int(np.ceil(np.linalg.norm(b - a) / step)))
        points.extend(a + (b - a) * k / count for k in range(count))
    return np.asarray(points)


def _areas(points: np.ndarray, triangles: np.ndarray) -> np.ndarray:
    p = points[triangles]
    return 0.5 * (
        (p[:, 1, 0] - p[:, 0, 0]) * (p[:, 2, 1] - p[:, 0, 1])
        - (p[:, 1, 1] - p[:, 0, 1]) * (p[:, 2, 0] - p[:, 0, 0])
    )


# Half a T-shirt front: hem, side seam, concave armhole, shoulder, neckline.
SHIRT_HALF = [(0, 0), (26, 0), (26, 45), (20, 50), (18, 52), (17, 58), (19, 64), (8, 66), (4, 62), (0, 61)]


class MesherTests(unittest.TestCase):
    def test_concave_panel_keeps_its_outline_and_area(self) -> None:
        for corners in (SHIRT_HALF, SHIRT_HALF[::-1]):
            outline = _resample(corners, 1.5)
            points, triangles = triangulate_panel(outline, 2.0)
            np.testing.assert_allclose(points[: len(outline)], outline)
            self.assertTrue(boundary_edges_present(triangles, len(outline)))
            areas = _areas(points, triangles)
            # Same winding as the outline, no flipped or empty triangles.
            self.assertTrue((np.sign(areas) == np.sign(areas.sum())).all())
            self.assertGreater(np.abs(areas).min(), 1e-3)
            polygon_area = abs(float(_areas(outline, np.array([[0, i, i + 1] for i in range(1, len(outline) - 1)])).sum()))
            self.assertAlmostEqual(abs(float(areas.sum())), polygon_area, places=6)
            edges = np.concatenate(
                [np.linalg.norm(points[triangles[:, i]] - points[triangles[:, (i + 1) % 3]], axis=1) for i in range(3)]
            )
            self.assertLessEqual(float(edges.max()), 2.0 + 1e-9)


class SewTests(unittest.TestCase):
    def _tube(self) -> dict:
        """Front and back 40x30 cm rectangles, 20 cm apart, sewn at both sides into a tube."""

        def rect(name: str, z: float, flip: bool) -> PanelOutline:
            corners = [np.array(c, dtype=np.float64) for c in ((0, 0), (40, 0), (40, 30), (0, 30))]
            counts = (28, 21, 28, 21)
            edges = [
                np.linspace(corners[i], corners[(i + 1) % 4], counts[i]) for i in range(4)
            ]
            rotation = np.diag([-1.0, 1.0, -1.0]) if flip else np.eye(3)
            translation = np.array([40.0 if flip else 0.0, 100.0, z])
            return PanelOutline(name=name, edges=edges, rotation=rotation, translation=translation)

        front = rect("ftorso", 10.0, False)
        back = rect("btorso", -10.0, True)
        stitches = [(("ftorso", 1), ("btorso", 3)), (("ftorso", 3), ("btorso", 1))]
        return sew_outlines([front, back], stitches)

    def test_stitched_edges_share_sample_counts(self) -> None:
        lengths = {("a", 0): 30.0, ("b", 2): 31.6, ("a", 1): 10.0}
        counts = edge_sample_counts(lengths, [(("a", 0), ("b", 2))], 1.5)
        self.assertEqual(counts[("a", 0)], counts[("b", 2)])
        self.assertEqual(counts[("a", 0)], 23)
        self.assertEqual(counts[("a", 1)], 8)
        with self.assertRaises(RuntimeError):
            edge_sample_counts(lengths, [(("a", 0), ("b", 2)), (("a", 0), ("a", 1))], 1.5)

    def test_tube_pairs_side_seams_in_3d_order_and_welds_closed(self) -> None:
        mesh = self._tube()
        positions = np.asarray(mesh["positions"]).reshape(-1, 3)
        stitches = np.asarray(mesh["stitches"])
        self.assertEqual(stitches.shape, (42, 2))
        # Paired vertices sit at the same height and the same side (metres).
        gaps = positions[stitches[:, 0]] - positions[stitches[:, 1]]
        np.testing.assert_allclose(gaps[:, 0], 0.0, atol=1e-9)
        np.testing.assert_allclose(gaps[:, 1], 0.0, atol=1e-9)
        np.testing.assert_allclose(np.abs(gaps[:, 2]), 0.2, atol=1e-9)

        welded = weld(mesh["stitches"], mesh["vertex_count"])
        self.assertEqual(int(welded.max()) + 1, mesh["vertex_count"] - 42)
        triangles = welded[np.asarray(mesh["triangles"]).reshape(-1, 3)]
        edge_use: dict[tuple[int, int], int] = {}
        for tri in triangles:
            for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
                key = (min(a, b), max(a, b))
                edge_use[key] = edge_use.get(key, 0) + 1
        boundary = [key for key, uses in edge_use.items() if uses == 1]
        # Only the hem and the top stay open: 2 x (27 + 27) boundary edges.
        self.assertEqual(len(boundary), 108)
        self.assertTrue(all(uses <= 2 for uses in edge_use.values()))

    def test_uv_is_the_flat_panel_in_metres(self) -> None:
        mesh = self._tube()
        uv = np.asarray(mesh["uv"]).reshape(-1, 2)
        self.assertAlmostEqual(float(uv[:, 0].max()), 0.4)
        self.assertAlmostEqual(float(uv[:, 1].max()), 0.3)


class SolverPrepTests(unittest.TestCase):
    def test_clockwise_panels_get_a_mirrored_rest_shape_with_the_same_lengths(self) -> None:
        # Live: Newton Style3D silently dropped every negative-area pattern
        # triangle, so the back panels vanished and the front fell to the floor.
        uv = np.array([[0, 0], [1, 0], [0, 1], [0, 0], [0, 1], [1, 0]], dtype=np.float64)
        triangles = np.array([[0, 1, 2], [3, 4, 5]])
        panel_of_vertex = np.array([0, 0, 0, 1, 1, 1])
        rest, mirrored = solver_rest_uv(uv, triangles, panel_of_vertex)
        self.assertEqual(mirrored, [1])
        corners = rest[triangles]
        signed = (corners[:, 1, 0] - corners[:, 0, 0]) * (corners[:, 2, 1] - corners[:, 0, 1]) - (
            corners[:, 1, 1] - corners[:, 0, 1]
        ) * (corners[:, 2, 0] - corners[:, 0, 0])
        self.assertTrue((signed > 0).all())
        for a, b in ((3, 4), (4, 5), (5, 3)):
            self.assertAlmostEqual(np.linalg.norm(rest[a] - rest[b]), np.linalg.norm(uv[a] - uv[b]))
        np.testing.assert_allclose(uv[:3], rest[:3])

    def test_mixed_winding_inside_one_panel_fails_closed(self) -> None:
        uv = np.array([[0, 0], [1, 0], [0, 1], [1, 1]], dtype=np.float64)
        with self.assertRaises(RuntimeError):
            solver_rest_uv(uv, np.array([[0, 1, 2], [1, 2, 3]]), np.zeros(4, dtype=np.int64))

    def test_weld_flattened_triangles_are_eased_open(self) -> None:
        # Three seam points averaged onto one line, inside a small fan.
        positions = np.array(
            [[0, 0, 0], [0.01, 0, 0], [0.02, 0, 0], [0.008, 0.012, 0.002], [0.013, -0.007, 0.0]], dtype=np.float64
        )
        triangles = np.array([[0, 1, 2], [0, 1, 3], [1, 2, 3], [0, 4, 1], [1, 4, 2]])
        flat = relax_flat_triangles(positions, triangles)
        self.assertEqual(flat, 1)
        corners = positions[triangles]
        areas = 0.5 * np.linalg.norm(np.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0]), axis=1)
        self.assertGreater(float(areas.min()), 1e-7)

if __name__ == "__main__":
    unittest.main()
