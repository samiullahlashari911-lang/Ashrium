"""Per-vertex photo coordinates + visibility for on-device avatar painting."""

from __future__ import annotations

import json
import struct
import sys
import unittest
from pathlib import Path

import numpy as np

COG_ROOT = Path(__file__).resolve().parents[1]
if str(COG_ROOT) not in sys.path:
    sys.path.insert(0, str(COG_ROOT))

from body.photo_uv import (  # noqa: E402
    mhr_cm_to_camera_m,
    mhr_lod1_faces,
    photo_uv_payload,
    project_view,
)

GLB = COG_ROOT.parent / "public" / "models" / "mhr-hull.glb"
IMAGE_HW = (640, 480)
FOCAL = 900.0
CAM_T = np.array([0.0, 0.86, 3.2])


def _rest_mesh_cm() -> np.ndarray:
    data = GLB.read_bytes()
    json_length = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20 : 20 + json_length])
    count = gltf["accessors"][0]["count"]
    return np.frombuffer(data, dtype=np.float32, count=count * 3, offset=20 + json_length + 8).reshape(-1, 3).astype(np.float64) * 100.0


def _turn_left(vertices_cm: np.ndarray) -> np.ndarray:
    """Shopper turns 90° so their left side faces the camera (+z)."""
    x, y, z = vertices_cm[:, 0], vertices_cm[:, 1], vertices_cm[:, 2]
    return np.column_stack([-z, y, x])


class PhotoUvTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.rest = _rest_mesh_cm()
        cls.uv, cls.weight = project_view(cls.rest, FOCAL, CAM_T, IMAGE_HW)

    def test_faces_asset_matches_the_shipped_hull(self) -> None:
        faces = mhr_lod1_faces()
        self.assertEqual(faces.shape, (36874, 3))
        self.assertEqual(int(faces.max()), self.rest.shape[0] - 1)

    def test_front_view_sees_chest_and_hides_back(self) -> None:
        y, z = self.rest[:, 1], self.rest[:, 2]
        torso = (y > 110) & (y < 135) & (np.abs(self.rest[:, 0]) < 8)
        chest = torso & (z > np.percentile(z[torso], 90))
        back = torso & (z < np.percentile(z[torso], 10))
        self.assertGreater((self.weight[chest] > 128).mean(), 0.95)
        self.assertEqual(int(self.weight[back].max()), 0)

    def test_image_axes_put_head_on_top_and_left_arm_on_image_right(self) -> None:
        head = self.rest[:, 1] > 160
        feet = self.rest[:, 1] < 10
        self.assertLess(self.uv[head, 1].mean(), self.uv[feet, 1].mean())
        left_hand = self.rest[:, 0] > 55
        self.assertGreater(self.uv[left_hand, 0].mean(), 0.5)
        inside = (self.uv >= 0) & (self.uv <= 1)
        self.assertTrue(inside.all())

    def test_side_view_hides_the_far_arm_behind_the_torso(self) -> None:
        turned = _turn_left(self.rest)
        _uv, weight = project_view(turned, FOCAL, CAM_T, IMAGE_HW)
        near_upper_arm = (self.rest[:, 0] > 20) & (self.rest[:, 0] < 35) & (self.rest[:, 1] > 115)
        far_upper_arm = (self.rest[:, 0] < -20) & (self.rest[:, 0] > -35) & (self.rest[:, 1] > 115)
        self.assertGreater((weight[near_upper_arm] > 0).mean(), 0.4)
        self.assertLess((weight[far_upper_arm] > 0).mean(), 0.05)

    def test_visibility_never_shows_a_vertex_a_ray_cast_says_is_hidden(self) -> None:
        # A leaky visibility test painted the torso onto the far arm. Ground
        # truth: cast a ray from the camera to each vertex through every triangle.
        faces = mhr_lod1_faces()
        for mesh in (self.rest, _turn_left(self.rest)):
            _uv, weight = project_view(mesh, FOCAL, CAM_T, IMAGE_HW)
            points = mhr_cm_to_camera_m(mesh, CAM_T)
            a, b, c = points[faces[:, 0]], points[faces[:, 1]], points[faces[:, 2]]
            e1, e2 = b - a, c - a
            shown = np.where(weight > 0)[0]
            sample = np.random.default_rng(7).choice(shown, 200, replace=False)
            for vertex in sample:
                distance = float(np.linalg.norm(points[vertex]))
                ray = points[vertex] / distance
                h = np.cross(ray, e2)
                det = (e1 * h).sum(axis=1)
                ok = np.abs(det) > 1e-12
                inv = 1.0 / np.where(ok, det, 1.0)
                u = inv * (-a * h).sum(axis=1)
                q = np.cross(-a, e1)
                v = inv * (q * ray).sum(axis=1)
                t = inv * (e2 * q).sum(axis=1)
                own = (faces == vertex).any(axis=1)
                blocked = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & ~own & (t > 0) & (t < distance - 0.01)
                self.assertFalse(blocked.any(), f"vertex {vertex} is shown but hidden")

    def test_head_above_the_headless_crop_is_still_seen(self) -> None:
        # The upload starts at the chin, so every head vertex projects above
        # the image (v < 0). They must still get a visibility weight: the
        # phone paints the head from its full frame and snaps the face onto
        # its landmarks using exactly these weights (all-zero disabled both).
        chin_at_top = np.array([0.0, 1.5 - 320.0 * 3.2 / FOCAL, 3.2])
        uv, weight = project_view(self.rest, FOCAL, chin_at_top, IMAGE_HW)
        y, z = self.rest[:, 1], self.rest[:, 2]
        face = (y > 152) & (y < 165) & (np.abs(self.rest[:, 0]) < 4) & (z > np.percentile(z[y > 152], 85))
        back_of_head = (y > 152) & (z < z[y > 152].min() + 4.0)
        self.assertLess(uv[face, 1].max(), 0.0, "face is above the headless upload")
        self.assertGreater((weight[face] > 0).mean(), 0.9)
        self.assertGreater(float(np.median(weight[face])), 128.0)
        self.assertEqual(int(weight[back_of_head].max()), 0)

    def test_payload_is_flat_json_with_one_entry_per_vertex(self) -> None:
        payload = photo_uv_payload(
            self.rest,
            _turn_left(self.rest),
            (FOCAL, CAM_T, IMAGE_HW),
            (FOCAL, CAM_T, IMAGE_HW),
        )
        count = self.rest.shape[0]
        self.assertEqual(len(payload["front_uv"]), count * 2)
        self.assertEqual(len(payload["side_weight"]), count)
        self.assertTrue(all(0 <= w <= 255 for w in payload["front_weight"]))
        json.dumps(payload)


if __name__ == "__main__":
    unittest.main()
