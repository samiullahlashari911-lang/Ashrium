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
from body.girths import measure_chest_waist_hip_cm, torso_landmarks_cm, torso_search_windows  # noqa: E402
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
            # Two legs, apart below the crotch at 78 cm.
            for side in (-1.0, 1.0):
                leg = _ellipse_ring(float(y), 6.0, 6.0)
                leg[:, 0] += side * 9.0
                rings.append(leg)
            continue
        if y < 98:
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

    def test_chest_stops_below_the_armpit_where_a_pose_arms_join_the_shoulder(self) -> None:
        # Real fit (173 cm male): A-pose arms hang off the torso up to the
        # armpit, then fuse into the shoulder below the clavicle. The chest
        # slice took that shoulder (+16 cm) and recommended tops 1-2 sizes up.
        bare, joints = _standing_torso(include_arms=False)
        rings = [bare]
        for y in np.arange(100.0, 132.0, 1.0):
            gap = 0.5 * (132.0 - y)
            for side in (-1.0, 1.0):
                arm = _ellipse_ring(float(y), 4.0, 4.0, count=24)
                arm[:, 0] += side * (16.0 + 4.0 + gap)
                rings.append(arm)
        for y in np.arange(132.0, 140.0, 1.0):
            rings.append(_ellipse_ring(float(y), 24.0, 12.0))
        shouldered = np.vstack(rings)
        torso_only = measure_chest_waist_hip_cm(bare, joints)
        girths = measure_chest_waist_hip_cm(shouldered, joints)
        self.assertLess(abs(girths["chest_cm"] - torso_only["chest_cm"]), 2.0)
        self.assertAlmostEqual(girths["waist_cm"], torso_only["waist_cm"], places=3)
        self.assertAlmostEqual(girths["hip_cm"], torso_only["hip_cm"], places=3)

    def test_chest_does_not_depend_on_where_spine1_sits(self) -> None:
        # Production (2026-10-09 18:26 UTC, 178 cm male): MHR c_spine1 sits
        # above the armpit, so no slice in [spine1, clavicle] showed the arm
        # gap, the search fell back to the shoulder slice and measured 109 cm
        # (replayed: 91 cm when the floor is below the armpit, 37.9 cm when it
        # sits exactly on it). The chest must not care where spine1 is.
        shouldered = self._shouldered_torso()
        _bare, joints = _standing_torso(include_arms=False)
        torso_only = measure_chest_waist_hip_cm(_bare, joints)
        for spine1 in (112.0, 118.0, 124.0, 128.0, 131.0, 133.0, 136.0):
            moved = joints.copy()
            moved[MHR_JOINT_C_SPINE1, 1] = spine1
            chest = measure_chest_waist_hip_cm(shouldered, moved)["chest_cm"]
            self.assertLess(abs(chest - torso_only["chest_cm"]), 2.0, f"spine1 at {spine1}: {chest:.1f}")

    def test_chest_ignores_the_joints_entirely(self) -> None:
        # Live GPU (2026-10-09, v14) still measured 109 cm while every local
        # replay with guessed joints gave 96.6 cm: the joints were the only
        # unknown. The chest is now mesh-only, so replays equal production.
        shouldered = self._shouldered_torso()
        _bare, joints = _standing_torso(include_arms=False)
        reference = measure_chest_waist_hip_cm(shouldered, joints)["chest_cm"]
        rng = np.random.default_rng(3)
        for _ in range(6):
            odd = joints + rng.normal(0.0, 15.0, joints.shape)
            chest = measure_chest_waist_hip_cm(shouldered, odd)["chest_cm"]
            self.assertAlmostEqual(chest, reference, places=6)

    def test_waist_and_hip_are_not_cut_by_the_joint_span(self) -> None:
        # Owner fit (2026-10-10, 173 cm male): MHR clavicle and upleg joints sit
        # close to the midline, so the joint-span lateral limit cut the sides
        # off the torso and read an 88 cm waist as 74 cm, a 109 cm hip as 87 cm.
        bare, joints = _standing_torso(include_arms=False)
        narrow = joints.copy()
        narrow[MHR_JOINT_L_CLAVICLE, 0] = -3.0
        narrow[MHR_JOINT_R_CLAVICLE, 0] = 3.0
        narrow[MHR_JOINT_L_UPLEG, 0] = -9.0
        narrow[MHR_JOINT_R_UPLEG, 0] = 9.0
        girths = measure_chest_waist_hip_cm(self._shouldered_torso(), narrow)
        waist_ring = 2.0 * np.pi * np.sqrt((11.0**2 + 9.0**2) / 2.0)
        hip_ring = 2.0 * np.pi * np.sqrt((18.0**2 + 14.0**2) / 2.0)
        self.assertAlmostEqual(girths["waist_cm"], waist_ring, delta=1.5)
        self.assertAlmostEqual(girths["hip_cm"], hip_ring, delta=1.5)
        self.assertEqual(girths, measure_chest_waist_hip_cm(self._shouldered_torso(), joints))

    def test_hip_is_the_seat_above_the_crotch_not_the_thighs(self) -> None:
        # Owner grid (2026-10-10): a fixed 40%-of-stature start measured a short
        # man's thighs as his hips (and anchored his trousers there).
        landmarks = torso_landmarks_cm(self._shouldered_torso())
        self.assertIsNotNone(landmarks)
        assert landmarks is not None
        self.assertAlmostEqual(landmarks["crotch_y"], 78.0, delta=1.0)
        self.assertGreater(landmarks["hip_y"], landmarks["crotch_y"])
        self.assertGreater(landmarks["waist_y"], landmarks["hip_y"])
        self.assertLess(landmarks["waist_y"], landmarks["armpit_y"])

    def test_waist_and_hip_ignore_hands_beside_the_hips(self) -> None:
        shouldered = self._shouldered_torso()
        rings = [shouldered]
        for y in np.arange(84.0, 100.0, 1.0):
            for side in (-1.0, 1.0):
                hand = _ellipse_ring(float(y), 3.0, 5.0, count=24)
                hand[:, 0] += side * 30.0
                rings.append(hand)
        _bare, joints = _standing_torso(include_arms=False)
        with_hands = measure_chest_waist_hip_cm(np.vstack(rings), joints)
        without = measure_chest_waist_hip_cm(shouldered, joints)
        self.assertAlmostEqual(with_hands["hip_cm"], without["hip_cm"], places=3)
        self.assertAlmostEqual(with_hands["waist_cm"], without["waist_cm"], places=3)

    @staticmethod
    def _shouldered_torso() -> np.ndarray:
        bare, _joints = _standing_torso(include_arms=False)
        rings = [bare]
        for y in np.arange(100.0, 132.0, 1.0):
            gap = 0.5 * (132.0 - y)
            for side in (-1.0, 1.0):
                arm = _ellipse_ring(float(y), 4.0, 4.0, count=24)
                arm[:, 0] += side * (16.0 + 4.0 + gap)
                rings.append(arm)
        for y in np.arange(132.0, 140.0, 1.0):
            rings.append(_ellipse_ring(float(y), 24.0, 12.0))
        return np.vstack(rings)

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

    def test_modal_app_pins_match_reviewed_shas(self) -> None:
        manifest = (COG_ROOT / "modal_app.py").read_text(encoding="utf-8")
        self.assertNotRegex(manifest, r"git clone --depth 1 https://github.com/")
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
