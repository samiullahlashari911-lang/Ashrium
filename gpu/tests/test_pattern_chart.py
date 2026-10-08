"""Size-chart parsing for GarmentCode grading: real charts publish only some girths."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

COG_ROOT = Path(__file__).resolve().parents[1]
if str(COG_ROOT) not in sys.path:
    sys.path.insert(0, str(COG_ROOT))

from pattern.instantiate import (  # noqa: E402
    _cross_check,
    _fill_unpublished_girths,
    _parse_size_chart,
)

TEMPLATE_BODY = {"bust": 100.0, "waist": 80.0, "hips": 104.0}


def chart(**entry: float) -> str:
    return json.dumps([{"sizeCode": "M", **entry}])


class SizeChartTests(unittest.TestCase):
    def test_tee_chart_with_chest_and_length_is_gradable(self) -> None:
        [size] = _parse_size_chart(chart(chestCm=108, lengthCm=73), "tee")
        self.assertEqual(size["published"], {"chestCm", "lengthCm"})

    def test_tee_without_chest_or_length_is_rejected(self) -> None:
        with self.assertRaises(RuntimeError):
            _parse_size_chart(chart(lengthCm=73), "tee")
        with self.assertRaises(RuntimeError):
            _parse_size_chart(chart(chestCm=108), "tee")

    def test_pant_needs_waist_or_hip_not_chest(self) -> None:
        [size] = _parse_size_chart(chart(waistCm=76, lengthCm=100), "pant")
        self.assertEqual(size["published"], {"waistCm", "lengthCm"})
        with self.assertRaises(RuntimeError):
            _parse_size_chart(chart(chestCm=100, lengthCm=100), "pant")

    def test_unpublished_girths_follow_template_proportions(self) -> None:
        [size] = _parse_size_chart(chart(chestCm=110, lengthCm=73), "tee")
        _fill_unpublished_girths(size, TEMPLATE_BODY)
        self.assertAlmostEqual(size["chestCm"], 110.0)
        self.assertAlmostEqual(size["waistCm"], 80.0 * 1.1)
        self.assertAlmostEqual(size["hipCm"], 104.0 * 1.1)
        self.assertEqual(size["published"], {"chestCm", "lengthCm"})

    def test_cross_check_ignores_inferred_girths(self) -> None:
        [size] = _parse_size_chart(chart(chestCm=110, lengthCm=73), "tee")
        _fill_unpublished_girths(size, TEMPLATE_BODY)
        # Pattern waist far from the inferred value: not a mismatch, it was never published.
        girths = {"chestCm": 112.0, "waistCm": 40.0, "hipCm": 40.0, "lengthCm": 74.0}
        self.assertIsNone(_cross_check("tee", size, girths))
        girths["chestCm"] = 60.0
        self.assertEqual(_cross_check("tee", size, girths), "chart_mismatch")


class ElasticWaistTests(unittest.TestCase):
    def test_gathered_waist_may_be_wider_than_the_relaxed_chart(self) -> None:
        [size] = _parse_size_chart(chart(waistCm=72, hipCm=100, lengthCm=102), "pant")
        girths = {"chestCm": 112.0, "waistCm": 96.0, "hipCm": 104.0, "lengthCm": 103.0}
        self.assertEqual(_cross_check("pant", size, girths), "chart_mismatch")
        self.assertIsNone(_cross_check("pant", size, girths, elastic_waist=True))
        girths["waistCm"] = 55.0  # narrower than the relaxed waist: still wrong
        self.assertEqual(_cross_check("pant", size, girths, elastic_waist=True), "chart_mismatch")

    def test_style_detects_elastic_waists(self) -> None:
        from pattern.style import parse_style

        self.assertTrue(parse_style("pant", "Casual Drawstring Jogger Pants")["elastic_waist"])
        self.assertFalse(parse_style("pant", "Wide Leg Chino Pants")["elastic_waist"])


class PatternGirthTests(unittest.TestCase):
    def test_straight_tee_chest_is_widest_point_below_armholes(self) -> None:
        from pattern.rest_length import pattern_girths_from_profile

        # Straight tee: 107 cm from hem to chest, narrowing into the armhole above 0.7.
        profile = [(t / 40, 107.0 if t / 40 <= 0.7 else 107.0 - (t / 40 - 0.7) * 120) for t in range(41)]
        girths = pattern_girths_from_profile(profile, "tee", 74.0)
        self.assertAlmostEqual(girths["chestCm"], 107.0)
        self.assertLessEqual(girths["waistCm"], girths["chestCm"])
        self.assertEqual(girths["lengthCm"], 74.0)


if __name__ == "__main__":
    unittest.main()
