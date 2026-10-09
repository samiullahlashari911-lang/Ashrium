"""Body part labels used to fill skin where a tried garment replaces clothes."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np

TOOLS = Path(__file__).resolve().parents[1] / "tools"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import build_body_parts as parts  # noqa: E402


class BodyPartTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.vertices = parts.rest_mesh_cm()
        cls.labels = parts.label_vertices(cls.vertices)

    def test_shipped_asset_matches_the_tool(self) -> None:
        shipped = np.frombuffer(parts.OUT.read_bytes(), dtype=np.uint8)
        np.testing.assert_array_equal(shipped, self.labels)

    def test_armpit_is_found_from_the_shoulder_not_the_hand(self) -> None:
        # Scanning up from the hips caught the thigh-to-hand gap (85 cm) and a
        # sparse chest row (130 cm) before the real armpit.
        for side in (1.0, -1.0):
            height, edge, _gaps = parts.armpit(self.vertices, side)
            self.assertGreater(height, 120.0)
            self.assertLess(height, 135.0)
            self.assertGreater(edge, 14.0)

    def test_torso_flanks_are_never_arm(self) -> None:
        x, y = self.vertices[:, 0], self.vertices[:, 1]
        flank = (np.abs(x) < 15.0) & (y < 125.0) & (y > 80.0)
        self.assertFalse(np.isin(self.labels[flank], [parts.ARM, parts.HAND]).any())

    def test_every_part_is_where_it_belongs(self) -> None:
        x, y = self.vertices[:, 0], self.vertices[:, 1]
        self.assertGreater(np.abs(x[self.labels == parts.HAND]).min(), 40.0)
        self.assertLess(y[self.labels == parts.FOOT].max(), parts.ANKLE_CM + 0.1)
        self.assertGreater(y[self.labels == parts.HEAD].min(), 140.0)
        arm = self.labels == parts.ARM
        self.assertGreater(arm.sum(), 800)
        self.assertGreater((x[arm] > 0).sum(), 400)
        self.assertGreater((x[arm] < 0).sum(), 400)
        self.assertGreater((self.labels == parts.UPPER_TORSO).sum(), 800)


if __name__ == "__main__":
    unittest.main()
