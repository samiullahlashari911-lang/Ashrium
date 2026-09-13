"""MHR skeleton layout, native joints, axes/units, convergence, height, rotations."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

import numpy as np

COG_ROOT = Path(__file__).resolve().parents[1]
if str(COG_ROOT) not in sys.path:
    sys.path.insert(0, str(COG_ROOT))

from body.coords import (  # noqa: E402
    SAM3D_METRES_TO_CM,
    mhr_cm_to_sam3d_camera_metres,
    remap_mhr_sam3d_axes,
    sam3d_camera_metres_to_mhr_cm,
)
from body.initializer import SAM3D_INFERENCE_TYPE, extract_loaded_mhr  # noqa: E402
from body.topology import (  # noqa: E402
    MHR_JOINT_COUNT,
    MHR_JOINT_QUAT_DIM,
    MHR_MODEL_PARAM_DIM,
    MHR_POSE_DIM,
    MHR_SKELETON_DIM,
    MHR_SKELETON_POS_END,
    MHR_SKELETON_POS_START,
    MHR_SKELETON_QUAT_END,
    MHR_SKELETON_QUAT_START,
    MHR_SKELETON_SCALE_INDEX,
    MHR_SKELETON_STATE_DIM,
    MHR_TOPOLOGY_VERSION,
    MHR_VERTEX_COUNT,
)

try:
    import torch

    from body.mhr_fit import (
        FIT_STEPS,
        MIN_FIT_STEPS,
        MIN_PLAUSIBLE_STATURE_CM,
        PLATEAU_PATIENCE,
        batched_view_model_params,
        native_joint_coords_mhr_cm,
        native_joint_rmse_cm,
        pack_model_params,
        plateau_count_after,
        project_scale_along_stature_gradient,
        silhouette_distance_fields,
        skeleton_positions,
        skeleton_quaternions,
    )

    HAS_TORCH = True
except ImportError:  # pragma: no cover - host without Cog torch
    torch = None  # type: ignore[assignment]
    HAS_TORCH = False


def _identity_quat() -> np.ndarray:
    quat = np.zeros(4, dtype=np.float32)
    quat[3] = 1.0
    return quat


class TopologyContractTests(unittest.TestCase):
    def test_lod1_stamp_and_skeleton_state_layout(self) -> None:
        self.assertEqual(MHR_TOPOLOGY_VERSION, "mhr-18439-127")
        self.assertEqual(MHR_VERTEX_COUNT, 18439)
        self.assertEqual(MHR_JOINT_COUNT, 127)
        self.assertEqual(MHR_MODEL_PARAM_DIM, 204)
        self.assertEqual(MHR_SKELETON_DIM, 68)
        self.assertEqual(MHR_POSE_DIM + MHR_SKELETON_DIM, MHR_MODEL_PARAM_DIM)
        self.assertEqual(MHR_SKELETON_STATE_DIM, 8)
        self.assertEqual((MHR_SKELETON_POS_START, MHR_SKELETON_POS_END), (0, 3))
        self.assertEqual((MHR_SKELETON_QUAT_START, MHR_SKELETON_QUAT_END), (3, 7))
        self.assertEqual(MHR_SKELETON_SCALE_INDEX, 7)
        self.assertEqual(MHR_JOINT_QUAT_DIM, 127 * 4)

    def test_shopper_initializer_is_body_only(self) -> None:
        self.assertEqual(SAM3D_INFERENCE_TYPE, "body")

    def test_extract_loaded_mhr_reuses_estimator_module(self) -> None:
        class FakeMhr:
            def eval(self) -> None:
                return None

            def __call__(self, *_args: object, **_kwargs: object) -> None:
                return None

        mhr = FakeMhr()
        estimator = SimpleNamespace(model=SimpleNamespace(head_pose=SimpleNamespace(mhr=mhr)))
        self.assertIs(extract_loaded_mhr(estimator), mhr)
        self.assertIsNone(extract_loaded_mhr(SimpleNamespace()))


class AxesAndUnitsTests(unittest.TestCase):
    def test_sam3d_metres_to_mhr_cm_flips_y_z_and_scales(self) -> None:
        camera_m = np.array([[0.02, 1.72, 0.10]], dtype=np.float32)
        mhr_cm = sam3d_camera_metres_to_mhr_cm(camera_m)
        np.testing.assert_allclose(mhr_cm, [[2.0, -172.0, -10.0]], atol=1e-4)
        self.assertEqual(SAM3D_METRES_TO_CM, 100.0)

    def test_axis_remap_is_an_involution(self) -> None:
        points = np.array([[1.0, 2.0, 3.0], [-4.0, 0.5, 8.0]], dtype=np.float32)
        np.testing.assert_allclose(remap_mhr_sam3d_axes(remap_mhr_sam3d_axes(points)), points)
        roundtrip = mhr_cm_to_sam3d_camera_metres(sam3d_camera_metres_to_mhr_cm(points))
        np.testing.assert_allclose(roundtrip, points, atol=1e-5)


@unittest.skipUnless(HAS_TORCH, "torch is required for MHR fit unit tests")
class NativeJointAndParamTests(unittest.TestCase):
    def test_pack_model_params_requires_official_204_and_refuses_pca_pad(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "pad scale_params"):
            pack_model_params({"scale_params": np.ones(28, dtype=np.float32)})
        with self.assertRaisesRegex(RuntimeError, "exactly 204"):
            pack_model_params({"mhr_model_params": np.ones(28, dtype=np.float32)})
        packed = pack_model_params({"mhr_model_params": np.arange(204, dtype=np.float32)})
        self.assertEqual(packed.shape, (204,))
        self.assertEqual(float(packed[-1]), 203.0)

    def test_native_joints_require_127_pred_joint_coords_not_70_keypoints(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "pred_joint_coords"):
            native_joint_coords_mhr_cm({"pred_keypoints_3d": np.zeros((70, 3), dtype=np.float32)})
        with self.assertRaisesRegex(RuntimeError, "127 native MHR joints"):
            native_joint_coords_mhr_cm({"pred_joint_coords": np.zeros((70, 3), dtype=np.float32)})

        coords_m = np.zeros((MHR_JOINT_COUNT, 3), dtype=np.float32)
        coords_m[1] = (0.03, 0.90, 0.04)
        converted = native_joint_coords_mhr_cm({"pred_joint_coords": coords_m})
        self.assertEqual(converted.shape, (127, 3))
        np.testing.assert_allclose(converted[1], [3.0, -90.0, -4.0], atol=1e-4)


@unittest.skipUnless(HAS_TORCH, "torch is required for MHR fit unit tests")
class SkeletonLayoutAndRotationTests(unittest.TestCase):
    def _state(self) -> "torch.Tensor":
        assert torch is not None
        state = torch.zeros(2, MHR_JOINT_COUNT, MHR_SKELETON_STATE_DIM)
        state[..., 0] = 11.0
        state[..., 1] = 22.0
        state[..., 2] = 33.0
        state[..., 3] = 0.1
        state[..., 4] = 0.2
        state[..., 5] = 0.3
        state[..., 6] = 0.9
        state[..., 7] = 7.0
        return state

    def test_positions_are_first_three_not_the_trailing_xyz_trap(self) -> None:
        assert torch is not None
        state = self._state()
        positions = skeleton_positions(state)
        self.assertEqual(tuple(positions.shape), (2, 127, 3))
        self.assertTrue(torch.allclose(positions[0, 0], torch.tensor([11.0, 22.0, 33.0])))
        last_three = state[0, 0, -3:]
        self.assertFalse(torch.allclose(positions[0, 0], last_three))
        with self.assertRaisesRegex(RuntimeError, "last dim must be 8"):
            skeleton_positions(torch.zeros(1, MHR_JOINT_COUNT, 3))
        with self.assertRaisesRegex(RuntimeError, "127"):
            skeleton_positions(torch.zeros(1, 70, 8))

    def test_joint_rotations_are_xyzw_quaternions_not_positions(self) -> None:
        assert torch is not None
        state = self._state()
        quats = skeleton_quaternions(state)
        self.assertEqual(tuple(quats.shape), (2, 127, 4))
        self.assertTrue(torch.allclose(quats[0, 0], torch.tensor([0.1, 0.2, 0.3, 0.9])))
        self.assertNotEqual(int(quats[0, 0].numel()), 3)
        flat = quats[0].reshape(-1)
        self.assertEqual(int(flat.numel()), MHR_JOINT_QUAT_DIM)
        identity = torch.tensor(_identity_quat().tolist())
        self.assertAlmostEqual(float(identity.norm()), 1.0, places=5)


@unittest.skipUnless(HAS_TORCH, "torch is required for MHR fit unit tests")
class AdaptiveConvergenceAndHeightTests(unittest.TestCase):
    def test_hard_max_and_minimum_useful_iterations(self) -> None:
        self.assertEqual(FIT_STEPS, 20)
        self.assertEqual(MIN_FIT_STEPS, 4)
        self.assertEqual(PLATEAU_PATIENCE, 3)
        self.assertEqual(MIN_PLAUSIBLE_STATURE_CM, 50.0)

    def test_plateau_counts_then_resets_on_a_real_step(self) -> None:
        self.assertEqual(plateau_count_after(0.0, 0.0, 0, 1.0), 1)
        self.assertEqual(plateau_count_after(1e-8, 1e-6, 2, 1.0), 3)
        self.assertEqual(plateau_count_after(0.5, 0.0, 2, 1.0), 0)
        self.assertEqual(plateau_count_after(0.0, 0.2, 2, 1.0), 0)

    def test_height_projection_moves_along_stature_gradient_not_uniform_scale(self) -> None:
        assert torch is not None
        scale = torch.tensor([1.0, 2.0, 3.0])
        stature = torch.tensor(100.0)
        grad = torch.tensor([100.0, 0.0, 0.0])
        project_scale_along_stature_gradient(scale, stature, grad, torch.tensor(172.0))
        self.assertAlmostEqual(float(scale[0]), 1.72, places=5)
        self.assertAlmostEqual(float(scale[1]), 2.0, places=5)
        self.assertAlmostEqual(float(scale[2]), 3.0, places=5)

    def test_height_projection_accounts_for_adam_delta_and_ignores_non_finite(self) -> None:
        assert torch is not None
        scale = torch.tensor([1.0, 2.0])
        project_scale_along_stature_gradient(
            scale,
            torch.tensor(100.0),
            torch.tensor([100.0, 0.0]),
            torch.tensor(172.0),
            adam_delta=torch.tensor([0.1, 0.0]),
        )
        # residual 72 minus 10 cm already taken by Adam → 62 / 10000 * 100 = 0.62
        self.assertAlmostEqual(float(scale[0]), 1.62, places=5)
        self.assertAlmostEqual(float(scale[1]), 2.0, places=5)

        frozen = torch.tensor([4.0, 5.0])
        project_scale_along_stature_gradient(
            frozen,
            torch.tensor(float("nan")),
            torch.tensor([1.0, 1.0]),
            torch.tensor(170.0),
        )
        self.assertEqual(float(frozen[0]), 4.0)

    def test_batched_views_share_scale_and_zero_canonical_pose(self) -> None:
        assert torch is not None
        front = torch.arange(MHR_POSE_DIM, dtype=torch.float32)
        side = torch.arange(MHR_POSE_DIM, dtype=torch.float32) * 2
        scale = torch.linspace(1.0, 2.0, MHR_SKELETON_DIM)
        batch = batched_view_model_params(front, side, scale)
        self.assertEqual(tuple(batch.shape), (3, MHR_MODEL_PARAM_DIM))
        self.assertTrue(torch.equal(batch[0, :MHR_POSE_DIM], front))
        self.assertTrue(torch.equal(batch[1, :MHR_POSE_DIM], side))
        self.assertTrue(torch.equal(batch[2, :MHR_POSE_DIM], torch.zeros(MHR_POSE_DIM)))
        self.assertTrue(torch.equal(batch[0, MHR_POSE_DIM:], scale))
        self.assertTrue(torch.equal(batch[2, MHR_POSE_DIM:], scale))

    def test_native_joint_rmse_is_centimetre_root_mean_square(self) -> None:
        assert torch is not None
        predicted = torch.zeros(127, 3)
        target = torch.zeros(127, 3)
        predicted[0, 0] = 3.0
        rmse = float(native_joint_rmse_cm(predicted, target))
        self.assertAlmostEqual(rmse, (9.0 / 127.0) ** 0.5, places=5)


@unittest.skipUnless(HAS_TORCH, "torch is required for MHR fit unit tests")
class SilhouetteDistanceTests(unittest.TestCase):
    def test_head_crop_band_is_unweighted_and_distance_is_outside_only(self) -> None:
        try:
            import cv2  # noqa: F401
        except ImportError:
            self.skipTest("opencv is required for silhouette distance fields")

        mask = np.zeros((100, 80), dtype=np.uint8)
        mask[0:70, 20:60] = 1
        distance, valid = silhouette_distance_fields(mask)
        self.assertEqual(float(valid[0, 40]), 0.0)
        self.assertEqual(float(valid[4, 40]), 0.0)
        self.assertGreater(float(valid[40, 40]), 0.5)
        self.assertEqual(float(distance[40, 40]), 0.0)
        self.assertGreater(float(distance[90, 10]), 0.0)

        intact = np.zeros((100, 80), dtype=np.uint8)
        intact[30:80, 20:60] = 1
        _distance, intact_valid = silhouette_distance_fields(intact)
        self.assertGreater(float(intact_valid[0, 40]), 0.5)
        self.assertGreater(float(intact_valid[35, 40]), 0.5)


if __name__ == "__main__":
    unittest.main()
