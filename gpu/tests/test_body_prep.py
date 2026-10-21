"""Per-body drape set-up cache (pipeline.body_prep): built once, keyed on the fitted body. No GPU."""

from __future__ import annotations

import json
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

COG_ROOT = Path(__file__).resolve().parents[1]
if str(COG_ROOT) not in sys.path:
    sys.path.insert(0, str(COG_ROOT))

try:
    import pipeline  # noqa: E402
except ImportError as error:  # the model packages only exist on the GPU image
    raise unittest.SkipTest(f"pipeline imports a GPU-only module: {error}")


def _bare_pipeline() -> "pipeline.AshriumPipeline":
    instance = object.__new__(pipeline.AshriumPipeline)
    instance._prep_lock = threading.Lock()
    instance._prep = pipeline.OrderedDict()
    return instance


class BodyPrepTests(unittest.TestCase):
    def setUp(self) -> None:
        rng = np.random.default_rng(3)
        self.fitted = rng.normal(0, 40, (12, 3)).astype(np.float32)
        self.calls = 0

        def collider(body_m: np.ndarray, _faces: np.ndarray) -> tuple:
            self.calls += 1
            time.sleep(0.05)
            return body_m * 2, np.zeros((1, 3), dtype=np.int64), 0.0

        patches = [
            mock.patch("drape.sewn.body_collider", collider),
            mock.patch("body.girths.torso_landmarks_cm", lambda body: {"waist_y": float(body[:, 1].mean())}),
            mock.patch("body.photo_uv.mhr_lod1_faces", lambda: np.zeros((1, 3), dtype=np.int64)),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def test_the_key_survives_the_apps_json_round_trip(self) -> None:
        emitted = self.fitted.reshape(-1).tolist()
        returned = np.asarray(json.loads(json.dumps(emitted)), dtype=np.float64).reshape(-1, 3)
        self.assertEqual(pipeline.body_key(self.fitted.astype(np.float64)), pipeline.body_key(returned))
        self.assertNotEqual(pipeline.body_key(self.fitted), pipeline.body_key(self.fitted + 0.01))

    def test_every_size_reuses_one_build_and_a_caller_waits_for_one_in_flight(self) -> None:
        instance = _bare_pipeline()
        body = self.fitted.astype(np.float64)
        results: list[dict] = []
        threads = [threading.Thread(target=lambda: results.append(instance.body_prep(body))) for _ in range(3)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        instance.body_prep(body)
        self.assertEqual(self.calls, 1)
        self.assertTrue(all(result is results[0] for result in results))

    def test_a_failed_build_is_not_cached(self) -> None:
        instance = _bare_pipeline()
        with mock.patch("drape.sewn.body_collider", side_effect=RuntimeError("no waist")):
            with self.assertRaises(RuntimeError):
                instance.body_prep(self.fitted.astype(np.float64))
        instance.body_prep(self.fitted.astype(np.float64))
        self.assertEqual(self.calls, 1)


if __name__ == "__main__":
    unittest.main()
