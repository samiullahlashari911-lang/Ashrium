"""SAM 3D Body camera space ↔ MHR native coordinates.

Documented conversions (Meta SAM 3D Body + Momentum MHR):

- MHR TorchScript vertices and skeleton translations are **centimetres**, Y-up.
- SAM 3D Body exports `pred_vertices` / `pred_joint_coords` in **metres**.
- SAM 3D Body camera axes are OpenCV: (x, -y, -z) relative to MHR Y-up.
  The map is an involution, so the same remap converts in either direction.
"""

from __future__ import annotations

import numpy as np

SAM3D_METRES_TO_CM = 100.0
# (x, y, z)_camera = (x, -y, -z)_mhr when both are expressed in the same unit.
SAM3D_CAMERA_AXIS_SIGN = np.array([1.0, -1.0, -1.0], dtype=np.float32)


def remap_mhr_sam3d_axes(points: np.ndarray) -> np.ndarray:
    """Flip Y and Z between MHR Y-up and SAM 3D Body's OpenCV camera frame."""
    array = np.asarray(points, dtype=np.float32)
    if array.shape[-1] != 3:
        raise RuntimeError(f"Expected (..., 3) xyz points, got shape {array.shape}.")
    return array * SAM3D_CAMERA_AXIS_SIGN


def sam3d_camera_metres_to_mhr_cm(points_m: np.ndarray) -> np.ndarray:
    """Native SAM 3D Body joints/verts (metres, camera) → MHR centimetres."""
    return remap_mhr_sam3d_axes(np.asarray(points_m, dtype=np.float32) * SAM3D_METRES_TO_CM)


def mhr_cm_to_sam3d_camera_metres(points_cm: np.ndarray) -> np.ndarray:
    """MHR centimetres → SAM 3D Body camera metres (for 2D projection)."""
    return remap_mhr_sam3d_axes(np.asarray(points_cm, dtype=np.float32)) / SAM3D_METRES_TO_CM
