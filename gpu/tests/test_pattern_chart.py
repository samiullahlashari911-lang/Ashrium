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
    CalibrationError,
    _cross_check,
    calibrate_to_chart,
    calibration_keys,
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


class CalibrationTests(unittest.TestCase):
    def test_pattern_is_recut_until_it_matches_the_chart(self) -> None:
        # Live: asking GarmentCode for a 104.9 cm chest / 64 cm tee gave 110.1 / 70.2.
        def garmentcode(proxy: dict) -> dict:
            return {"chestCm": proxy["chestCm"] * 1.05, "lengthCm": proxy["lengthCm"] * 1.097 - 0.1}

        target = {"sizeCode": "M", "chestCm": 104.9, "lengthCm": 64.0, "published": {"chestCm", "lengthCm"}}
        girths, iterations = calibrate_to_chart(target, ["chestCm", "lengthCm"], garmentcode)
        self.assertLessEqual(abs(girths["chestCm"] - 104.9), 1.0)
        self.assertLessEqual(abs(girths["lengthCm"] - 64.0), 1.0)
        self.assertGreater(iterations, 1)
        self.assertEqual(target["chestCm"], 104.9, "the chart itself is never changed")

    def test_a_size_that_cannot_match_fails(self) -> None:
        def stuck(proxy: dict) -> dict:
            return {"chestCm": 120.0, "lengthCm": proxy["lengthCm"]}

        with self.assertRaises(CalibrationError):
            calibrate_to_chart({"chestCm": 100.0, "lengthCm": 70.0}, ["chestCm", "lengthCm"], stuck)

    def test_a_clamped_input_is_stepped_out_of_its_clamp(self) -> None:
        # Live (joggers XL): GarmentCode caps a trouser's length ratio at 0.9, so
        # the first proxies all gave the same 102.6 cm and the plain update crept
        # out of the clamp too slowly to converge in the iteration budget.
        def garmentcode(proxy: dict) -> dict:
            ratio = min(proxy["lengthCm"] / 80.0, 0.9)
            return {"hipCm": proxy["hipCm"] * 1.116, "lengthCm": 114.0 * ratio}

        target = {"sizeCode": "XL", "hipCm": 108.2, "lengthCm": 98.0, "published": {"hipCm", "lengthCm"}}
        girths, iterations = calibrate_to_chart(target, ["hipCm", "lengthCm"], garmentcode)
        self.assertLessEqual(abs(girths["lengthCm"] - 98.0), 1.0)
        self.assertLessEqual(iterations, 8)

    def test_keys_are_the_published_values_plus_length(self) -> None:
        self.assertEqual(calibration_keys("tee", {"chestCm", "lengthCm"}, False), ["chestCm", "lengthCm"])
        self.assertEqual(
            calibration_keys("pant", {"waistCm", "hipCm", "lengthCm"}, True), ["hipCm", "lengthCm"]
        )


class NecklineTests(unittest.TestCase):
    def test_crewneck_in_the_name_cuts_a_crewneck(self) -> None:
        from pattern.style import CREWNECK_COLLAR, parse_style

        crew = parse_style("tee", "Men's Crewneck Short Sleeve T-Shirt / Black")
        self.assertEqual(crew["collar_fc_depth"], CREWNECK_COLLAR["collar_fc_depth"])
        self.assertEqual(crew["collar_width"], CREWNECK_COLLAR["collar_width"])
        plain = parse_style("tee", "Relaxed T-Shirt")
        self.assertNotIn("collar_fc_depth", plain)


if __name__ == "__main__":
    unittest.main()
