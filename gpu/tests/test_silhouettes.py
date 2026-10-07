"""SAM 2 mask selection: keep the head-cropped person, reject wall and floor masks."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np

COG_ROOT = Path(__file__).resolve().parents[1]
if str(COG_ROOT) not in sys.path:
    sys.path.insert(0, str(COG_ROOT))

try:
    from body.silhouettes import pick_person_mask, person_mask_area

    HAS_TORCH = True
except ImportError:  # silhouettes imports torch at module level
    HAS_TORCH = False

H, W = 400, 300


def person() -> np.ndarray:
    """Head-cropped A-pose: torso from the neck crop, two legs to the feet, arms out."""
    mask = np.zeros((H, W), bool)
    mask[0:200, 110:190] = True  # torso from the cropped neck
    mask[200:390, 112:145] = True  # left leg
    mask[200:390, 155:188] = True  # right leg (gap between the legs)
    mask[20:120, 60:110] = True  # arms angled down and out
    mask[20:120, 190:240] = True
    return mask


@unittest.skipUnless(HAS_TORCH, "torch is required to import body.silhouettes")
class PersonMaskTests(unittest.TestCase):
    def test_accepts_head_cropped_person(self) -> None:
        area = person_mask_area(person())
        self.assertIsNotNone(area)
        self.assertAlmostEqual(area, float(person().mean()))

    def test_rejects_wall_behind_person(self) -> None:
        # What a single centred prompt between the legs returns.
        self.assertIsNone(person_mask_area(~person()))

    def test_rejects_person_merged_with_floor(self) -> None:
        merged = person()
        merged[360:, :] = True
        self.assertIsNone(person_mask_area(merged))

    def test_rejects_torso_fragment(self) -> None:
        fragment = np.zeros((H, W), bool)
        fragment[0:150, 110:190] = True  # never reaches the feet
        self.assertIsNone(person_mask_area(fragment))

    def test_rejects_empty_mask(self) -> None:
        self.assertIsNone(person_mask_area(np.zeros((H, W), bool)))

    def test_rejects_speckled_wall_fragment(self) -> None:
        # Low-contrast wall comes back from SAM 2 as speckle beside the body.
        speckle = np.zeros((H, W), bool)
        speckle[10:390:3, 200:290:3] = True
        speckle[10:390, 230] = True  # thin streak so it still spans top to bottom
        self.assertIsNone(person_mask_area(speckle))

    def test_pick_prefers_mask_most_prompts_agree_on(self) -> None:
        bigger_outlier = person()
        bigger_outlier[100:390, 190:240] = True  # person + wall beside them: larger, seen once
        picked = pick_person_mask([person(), person(), person(), bigger_outlier])
        self.assertIsNotNone(picked)
        self.assertTrue(np.array_equal(picked, person()))

    def test_pick_returns_none_without_a_person(self) -> None:
        self.assertIsNone(pick_person_mask([~person(), np.zeros((H, W), bool)]))


if __name__ == "__main__":
    unittest.main()
