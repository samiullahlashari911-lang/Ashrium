"""Newton API contract for task=drape (Newton/CUDA are not available off-GPU)."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

SOURCE = (Path(__file__).resolve().parents[1] / "drape" / "newton_xpbd.py").read_text(encoding="utf-8")
PINS = (Path(__file__).resolve().parents[1] / "requirements-modal.txt").read_text(encoding="utf-8")


class NewtonApiTests(unittest.TestCase):
    def test_gravity_goes_through_set_gravity_on_newton_1_5(self) -> None:
        # Live /drape returned 500 for every shopper: "integrate_particles,
        # argument 'gravity' expects array(ndim=1, dtype=vec3f), but passed
        # value has type vec3f". Newton 1.5 keeps per-world gravity.
        self.assertIn("newton==1.5.1", PINS)
        self.assertIn("model.set_gravity((0.0, 0.0, -9.81))", SOURCE)
        unguarded = [
            line for line in SOURCE.splitlines()
            if re.match(r"\s*model\.gravity\s*=", line)
        ]
        self.assertEqual(len(unguarded), 1, "only the pre-1.5 fallback may assign a vec3")
        fallback_index = SOURCE.index(unguarded[0].strip())
        self.assertGreater(fallback_index, SOURCE.index("else:", SOURCE.index("set_gravity")))


if __name__ == "__main__":
    unittest.main()
