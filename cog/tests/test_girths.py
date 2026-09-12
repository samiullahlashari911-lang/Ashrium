"""Joint-informed ISO girth geometry and non-biometric diagnostics."""

from __future__ import annotations

import sys
import time
import unittest
from pathlib import Path

import numpy as np

COG_ROOT = Path(__file__).resolve().parents[1]
if str(COG_ROOT) not in sys.path:
    sys.path.insert(0, str(COG_ROOT))

from body.diagnostics import StageClock, merge_fit_diagnostics  # noqa: E402
from body.girths import measure_chest_waist_hip_cm, torso_search_windows  # noqa: E402
from body.pins import PINNED_GIT_SHAS  # noqa: E402
from body.topology import (  # noqa: E402
    MHR_JOINT_C_NECK,
    MHR_JOINT_C_SPINE0,
    MHR_JOINT_C_SPINE1,
    MHR_JOINT_C_SPINE2,
    MHR_JOINT_C_SPINE3,
    MHR_JOINT_COUNT,
    MHR_JOINT_L_CLAVICLE,
    MHR_JOINT_L_UPLEG,
    MHR_JOINT_R_CLAVICLE,
    MHR_JOINT_R_UPLEG,
    MHR_JOINT_ROOT,
)


def _ellipse_ring(y: float, rx: float, rz: float, count: int = 48) -> np.ndarray:
    theta = np.linspace(0.0, 2.0 * np.pi, count, endpoint=False)
    return np.column_stack(
        [rx * np.cos(theta), np.full(count, y), rz * np.sin(theta)]
    )


def _standing_torso(include_arms: bool) -> tuple[np.ndarray, np.ndarray]:
    rings: list[np.ndarray] = []
    for y in np.arange(0.0, 181.0, 2.0):
        if y < 78:
            rx, rz = 7.0, 6.0
        elif y < 98:
            rx, rz = 18.0, 14.0
        elif y < 116:
            rx, rz = 11.0, 9.0
        elif y < 140:
            rx, rz = 16.0, 13.0
        else:
            rx, rz = 8.0, 8.0
        rings.append(_ellipse_ring(float(y), rx, rz))
        if include_arms and 124.0 <= y <= 132.0:
            left = _ellipse_ring(float(y), 4.0, 4.0)
            left[:, 0] -= 28.0
            right = _ellipse_ring(float(y), 4.0, 4.0)
            right[:, 0] += 28.0
            rings.extend([left, right])

    vertices = np.vstack(rings).astype(np.float64)
    joints = np.zeros((MHR_JOINT_COUNT, 3), dtype=np.float64)
    joints[:, 1] = 90.0
    joints[MHR_JOINT_ROOT] = (0.0, 96.0, 0.0)
    joints[MHR_JOINT_L_UPLEG] = (-16.0, 88.0, 0.0)
    joints[MHR_JOINT_R_UPLEG] = (16.0, 88.0, 0.0)
    joints[MHR_JOINT_C_SPINE0] = (0.0, 106.0, 0.0)
    joints[MHR_JOINT_C_SPINE1] = (0.0, 118.0, 0.0)
    joints[MHR_JOINT_C_SPINE2] = (0.0, 128.0, 0.0)
    joints[MHR_JOINT_C_SPINE3] = (0.0, 136.0, 0.0)
    joints[MHR_JOINT_L_CLAVICLE] = (-15.0, 142.0, 0.0)
    joints[MHR_JOINT_R_CLAVICLE] = (15.0, 142.0, 0.0)
    joints[MHR_JOINT_C_NECK] = (0.0, 150.0, 0.0)
    return vertices, joints


class GirthGeometryTests(unittest.TestCase):
    def test_search_windows_follow_native_torso_joints(self) -> None:
        _vertices, joints = _standing_torso(include_arms=False)
        windows = torso_search_windows(joints, up_axis=1)
        self.assertAlmostEqual(windows["chest"]["plane"], 132.0, places=5)
        self.assertAlmostEqual(windows["waist"]["plane"], 106.0, places=5)
        self.assertGreater(windows["chest"]["plane"], windows["waist"]["plane"])
        self.assertGreater(windows["waist"]["plane"], windows["hip"]["plane"])
        self.assertLess(windows["hip"]["lo"], float(joints[MHR_JOINT_L_UPLEG, 1]))
        self.assertGreater(windows["lateral"]["hip_half"], windows["lateral"]["waist_half"])

    def test_hourglass_min_waist_max_chest_and_hip(self) -> None:
        vertices, joints = _standing_torso(include_arms=False)
        girths = measure_chest_waist_hip_cm(vertices, joints)
        self.assertGreater(girths["chest_cm"], girths["waist_cm"])
        self.assertGreater(girths["hip_cm"], girths["waist_cm"])
        self.assertGreater(girths["chest_cm"], 70.0)
        self.assertLess(girths["waist_cm"], girths["chest_cm"] - 8.0)

    def test_clavicle_arm_exclusion_keeps_chest_from_a_pose_span(self) -> None:
        bare, joints = _standing_torso(include_arms=False)
        armed, _ = _standing_torso(include_arms=True)
        without_arms = measure_chest_waist_hip_cm(bare, joints)
        with_arms = measure_chest_waist_hip_cm(armed, joints)
        self.assertLess(
            abs(with_arms["chest_cm"] - without_arms["chest_cm"]),
            4.0,
        )

    def test_rejects_non_native_joint_count(self) -> None:
        vertices, _joints = _standing_torso(include_arms=False)
        with self.assertRaises(RuntimeError):
            measure_chest_waist_hip_cm(vertices, np.zeros((70, 3)))


class DiagnosticsTests(unittest.TestCase):
    def test_stage_clock_and_merge_keep_finite_non_biometric_metrics(self) -> None:
        clock = StageClock()
        with clock.measure("sam2_front"):
            time.sleep(0.01)
        clock.set("setup", 1200.5)
        timings = clock.as_dict()
        self.assertGreaterEqual(timings["sam2_front"], 8.0)
        self.assertEqual(timings["setup"], 1200.5)

        result: dict[str, object] = {}
        merge_fit_diagnostics(
            result,
            iteration_count=7,
            native_joint_rmse_cm=1.25,
            height_residual_cm=0.4,
            silhouette_residual=0.08,
            stage_timings_ms=timings,
        )
        diagnostics = result["fit_diagnostics"]
        assert isinstance(diagnostics, dict)
        self.assertEqual(diagnostics["iteration_count"], 7)
        self.assertEqual(diagnostics["native_joint_rmse_cm"], 1.25)
        self.assertEqual(diagnostics["height_residual_cm"], 0.4)
        self.assertEqual(diagnostics["silhouette_residual"], 0.08)
        self.assertIn("sam2_front", diagnostics["stage_timings_ms"])
        self.assertNotIn("front_image", result)
        self.assertNotIn("mask", diagnostics)

    def test_merge_drops_unknown_and_non_finite_fields(self) -> None:
        result: dict[str, object] = {
            "fit_diagnostics": {
                "mask": "secret",
                "landmarks": [1, 2, 3],
                "native_joint_rmse_cm": float("nan"),
                "iteration_count": 3,
                "stage_timings_ms": {"secret_photo_ms": 9, "setup": 12.5},
            }
        }
        merge_fit_diagnostics(
            result,
            iteration_count=4,
            native_joint_rmse_cm=float("inf"),
            silhouette_residual=-0.2,
            mask="nope",
            stage_timings_ms={"setup": 15.0, "secret_photo_ms": 99.0},
        )
        diagnostics = result["fit_diagnostics"]
        assert isinstance(diagnostics, dict)
        self.assertEqual(diagnostics["iteration_count"], 4)
        self.assertNotIn("native_joint_rmse_cm", diagnostics)
        self.assertNotIn("silhouette_residual", diagnostics)
        self.assertNotIn("mask", diagnostics)
        self.assertNotIn("landmarks", diagnostics)
        self.assertEqual(diagnostics["stage_timings_ms"], {"setup": 15.0})

    def test_cog_yaml_pins_match_reviewed_shas(self) -> None:
        manifest = (COG_ROOT / "cog.yaml").read_text(encoding="utf-8")
        self.assertNotRegex(manifest, r"git clone --depth 1 https://github.com/")
        self.assertNotRegex(manifest, r'git\+https://github.com/[^"\s]+(?<!@[0-9a-f]{40})"')
        self.assertIn(
            'pip install --no-build-isolation --no-deps "git+https://github.com/facebookresearch/sam2.git@',
            manifest,
        )
        for sha in PINNED_GIT_SHAS:
            self.assertEqual(len(sha), 40, sha)
            self.assertIn(sha, manifest)
        for repo in (
            "facebookresearch/sam-3d-body",
            "facebookresearch/detectron2",
            "facebookresearch/sam2",
            "microsoft/MoGe",
            "facebookresearch/dinov3",
            "maria-korosteleva/GarmentCode",
        ):
            self.assertIn(repo, manifest)


if __name__ == "__main__":
    unittest.main()
