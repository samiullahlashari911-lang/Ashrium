"""Sewn-drape guards that run without a GPU: too-small sizes, fabric stretch, quality limits."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np

COG_ROOT = Path(__file__).resolve().parents[1]
if str(COG_ROOT) not in sys.path:
    sys.path.insert(0, str(COG_ROOT))

try:
    from drape.sewn import drape_quality, gather_elastic_waist, too_small  # noqa: E402
except ImportError as error:  # newton/warp only exist on the GPU image
    raise unittest.SkipTest(f"drape.sewn imports a GPU-only module: {error}")


class TooSmallTests(unittest.TestCase):
    def test_tops_need_ease_over_the_chest(self) -> None:
        body = {"chest_cm": 100.0, "waist_cm": 90.0, "hip_cm": 100.0}
        self.assertIsNone(too_small("tee", {"chestCm": 104.0}, body))
        self.assertIn("chest", too_small("tee", {"chestCm": 101.0}, body) or "")

    def test_bottoms_close_at_the_seat_and_skip_an_elastic_waist(self) -> None:
        body = {"chest_cm": 100.0, "waist_cm": 96.0, "hip_cm": 104.0}
        joggers = {"waistCm": 90.0, "hipCm": 110.0}
        self.assertIsNone(too_small("pant", joggers, body, elastic_waist=True))
        self.assertIn("waist", too_small("pant", joggers, body, elastic_waist=False) or "")
        self.assertIn("hip", too_small("pant", {"hipCm": 104.0}, body, elastic_waist=True) or "")

    def test_unpublished_girths_never_block(self) -> None:
        self.assertIsNone(too_small("tee", {"chestCm": 0.0}, {"chest_cm": 120.0}))


class ElasticWaistTests(unittest.TestCase):
    def test_top_band_is_gathered_to_the_relaxed_waist_and_the_leg_is_not(self) -> None:
        # One panel 0.4 m wide, 1 m tall; the waist is its top edge.
        uv = np.array([[0.0, 1.0], [0.4, 1.0], [0.0, 0.97], [0.4, 0.97], [0.0, 0.5], [0.4, 0.5]])
        panels = np.zeros(6, dtype=np.int64)
        factor = gather_elastic_waist(uv, panels, sewn_waist_cm=90.0, relaxed_waist_cm=72.0)
        self.assertAlmostEqual(factor, 0.8)
        self.assertAlmostEqual(uv[1, 0] - uv[0, 0], 0.32)
        self.assertAlmostEqual(uv[3, 0] - uv[2, 0], 0.32)
        self.assertAlmostEqual(uv[5, 0] - uv[4, 0], 0.4)

    def test_a_waist_already_at_its_relaxed_size_is_left_alone(self) -> None:
        uv = np.array([[0.0, 1.0], [0.4, 1.0]])
        self.assertEqual(gather_elastic_waist(uv, np.zeros(2, dtype=np.int64), 70.0, 72.0), 1.0)
        self.assertAlmostEqual(uv[1, 0], 0.4)


class QualityTests(unittest.TestCase):
    def _arranged(self) -> dict:
        uv = np.array([[0.0, 0.0], [0.1, 0.0], [0.0, 0.1]])
        tri = np.array([[0, 1, 2]])
        return {"rest_uv": uv, "welded_triangles": tri, "panel_triangles": tri}

    def test_overstretched_and_inside_cloth_fail(self) -> None:
        stretched = np.array([[0.0, 0.0, 0.0], [0.4, 0.0, 0.0], [0.0, 0.1, 0.0]])
        border = {"inside_after": 3, "deepest_before_mm": -5.0}
        metrics, problems = drape_quality("tee", stretched, self._arranged(), np.full(3, 0.01), border, True, None)
        codes = {p["code"] for p in problems if p["level"] == "fail"}
        self.assertIn("torn", codes)
        self.assertIn("inside_body", codes)
        self.assertGreater(metrics["stretch_max"], 3.0)

    def test_waistband_below_the_waist_warns(self) -> None:
        rest = np.array([[0.0, 0.9, 0.0], [0.1, 0.9, 0.0], [0.0, 1.0, 0.0]])
        border = {"inside_after": 0, "deepest_before_mm": -1.0}
        _metrics, problems = drape_quality("pant", rest, self._arranged(), np.full(3, 0.01), border, True, 1.10)
        self.assertIn("slid_down", {p["code"] for p in problems})


if __name__ == "__main__":
    unittest.main()
