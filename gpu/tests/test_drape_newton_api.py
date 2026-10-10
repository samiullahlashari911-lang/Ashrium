"""Newton API contract for task=drape (Newton/CUDA are not available off-GPU)."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

SOURCE = (Path(__file__).resolve().parents[1] / "drape" / "newton_style3d.py").read_text(encoding="utf-8")
PINS = (Path(__file__).resolve().parents[1] / "requirements-modal.txt").read_text(encoding="utf-8")


class NewtonApiTests(unittest.TestCase):
    def test_gravity_is_written_in_place_as_a_per_world_array_on_newton_1_5(self) -> None:
        # Live /drape returned 500 for every shopper: "integrate_particles,
        # argument 'gravity' expects array(ndim=1, dtype=vec3f), but passed
        # value has type vec3f". Newton 1.5 keeps per-world gravity, and the
        # captured CUDA graph keeps reading the same array, so it is assigned
        # in place, never replaced.
        self.assertIn("newton==1.5.1", PINS)
        self.assertIn("model.gravity.assign(", SOURCE)
        self.assertEqual([line for line in SOURCE.splitlines() if re.match(r"\s*model\.gravity\s*=", line)], [])


if __name__ == "__main__":
    unittest.main()
