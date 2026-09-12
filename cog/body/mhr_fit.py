"""Joint two-view MHR fit. Shared identity (20 body) + shared skeleton (68); per-view pose."""

from __future__ import annotations

import time
from typing import Any

import numpy as np
import torch
import torch.nn.functional as F

from .coords import SAM3D_METRES_TO_CM, sam3d_camera_metres_to_mhr_cm
from .diagnostics import elapsed_ms, merge_fit_diagnostics
from .girths import measure_chest_waist_hip_cm
from .topology import (
    MHR_BODY_IDENTITY_DIM,
    MHR_IDENTITY_DIM,
    MHR_JOINT_COUNT,
    MHR_JOINT_QUAT_DIM,
    MHR_MODEL_PARAM_DIM,
    MHR_POSE_DIM,
    MHR_SKELETON_DIM,
    MHR_SKELETON_POS_END,
    MHR_SKELETON_POS_START,
    MHR_SKELETON_QUAT_END,
    MHR_SKELETON_QUAT_START,
    MHR_SKELETON_STATE_DIM,
    MHR_TOPOLOGY_VERSION,
    MHR_VERTEX_COUNT,
)

KEYPOINT_LOSS_WEIGHT = 1.0
SILHOUETTE_LOSS_WEIGHT = 0.05
IDENTITY_REG_WEIGHT = 0.01
FIT_STEPS = 20
MIN_FIT_STEPS = 4
PLATEAU_PATIENCE = 3
LOSS_PLATEAU_REL = 0.002
PARAM_PLATEAU_EPS = 1e-4
FIT_LR = 0.05
STATURE_GRAD_EPS = 1e-8
# Official MHR TorchScript vertices / skeleton translations are centimetres.
MIN_PLAUSIBLE_STATURE_CM = 50.0
HEAD_CROP_TOP_FRAC = 0.08
HEAD_CROP_NECK_FRAC = 0.10
SILHOUETTE_DIST_CAP_FRAC = 0.20


def _finite_1d(value: Any, length: int, label: str) -> np.ndarray:
    array = np.asarray(value, dtype=np.float32).reshape(-1)
    if array.shape[0] != length:
        raise RuntimeError(f"{label} must have exactly {length} values, got {array.shape[0]}.")
    if not np.isfinite(array).all():
        raise RuntimeError(f"{label} contains non-finite values.")
    return array


def pack_model_params(person: dict[str, Any]) -> np.ndarray:
    """Require the official 204-value MHR vector. Never pad 28 PCA scale coeffs to 68."""
    if "mhr_model_params" not in person:
        raise RuntimeError(
            "SAM 3D Body output missing mhr_model_params (204). "
            "Refusing to pad scale_params (28 PCA) as 68 skeleton parameters."
        )
    return _finite_1d(person["mhr_model_params"], MHR_MODEL_PARAM_DIM, "mhr_model_params")


def native_joint_coords_mhr_cm(person: dict[str, Any]) -> np.ndarray:
    """SAM 3D Body pred_joint_coords: 127 native MHR joints, metres, camera axes → MHR cm."""
    if "pred_joint_coords" not in person:
        raise RuntimeError(
            "SAM 3D Body output missing pred_joint_coords (127 native MHR joints). "
            "Do not fit against pred_keypoints_3d (70 regressed landmarks)."
        )
    coords = np.asarray(person["pred_joint_coords"], dtype=np.float32).reshape(-1, 3)
    if coords.shape[0] != MHR_JOINT_COUNT:
        raise RuntimeError(
            f"pred_joint_coords must have {MHR_JOINT_COUNT} native MHR joints, "
            f"got {coords.shape[0]}. Do not pair pred_keypoints_3d with the first "
            "70 skeleton joints."
        )
    if not np.isfinite(coords).all():
        raise RuntimeError("pred_joint_coords contains non-finite values.")
    return sam3d_camera_metres_to_mhr_cm(coords)


def load_mhr_script(path: str, device: torch.device) -> torch.nn.Module:
    if not path:
        raise RuntimeError("MHR TorchScript path is empty. Do not stub the body model.")
    module = torch.jit.load(path, map_location=device)
    module.to(device)
    module.eval()
    return module


def _forward_mhr(
    mhr: torch.nn.Module,
    identity: torch.Tensor,
    model_params: torch.Tensor,
    face: torch.Tensor,
) -> tuple[torch.Tensor, torch.Tensor]:
    outputs = mhr(identity, model_params, face)
    if isinstance(outputs, (tuple, list)) and len(outputs) >= 2:
        return outputs[0], outputs[1]
    raise RuntimeError("MHR TorchScript did not return (vertices, skeleton_state).")


def _require_skeleton_state(skel_state: torch.Tensor) -> torch.Tensor:
    if skel_state.ndim != 3:
        raise RuntimeError(f"Unexpected MHR skeleton_state shape {tuple(skel_state.shape)}")
    if skel_state.shape[-1] != MHR_SKELETON_STATE_DIM:
        raise RuntimeError(
            "MHR skeleton_state last dim must be 8 "
            f"(coords[{MHR_SKELETON_POS_START}:{MHR_SKELETON_POS_END}], "
            f"quaternion[{MHR_SKELETON_QUAT_START}:{MHR_SKELETON_QUAT_END}], "
            f"scale[{MHR_SKELETON_STATE_DIM - 1}]), got {tuple(skel_state.shape)}."
        )
    if skel_state.shape[-2] != MHR_JOINT_COUNT:
        raise RuntimeError(
            f"MHR skeleton_state must have {MHR_JOINT_COUNT} joints, got {skel_state.shape[-2]}."
        )
    return skel_state


def skeleton_positions(skel_state: torch.Tensor) -> torch.Tensor:
    """World-space joint translations. Official layout is coords [0:3], not the last three."""
    return _require_skeleton_state(skel_state)[..., MHR_SKELETON_POS_START:MHR_SKELETON_POS_END]


def skeleton_quaternions(skel_state: torch.Tensor) -> torch.Tensor:
    """World-space joint rotations as xyzw quaternions [3:7]."""
    return _require_skeleton_state(skel_state)[..., MHR_SKELETON_QUAT_START:MHR_SKELETON_QUAT_END]


def skeleton_height_cm(skel_state: torch.Tensor) -> torch.Tensor:
    positions = skeleton_positions(skel_state)
    spans = positions.amax(dim=-2) - positions.amin(dim=-2)
    return spans.amax(dim=-1)


def mesh_stature_cm(vertices: torch.Tensor) -> torch.Tensor:
    spans = vertices.amax(dim=-2) - vertices.amin(dim=-2)
    return spans.amax(dim=-1)


def canonical_model_params(scale: torch.Tensor) -> torch.Tensor:
    params = torch.zeros(scale.shape[0], MHR_MODEL_PARAM_DIM, device=scale.device, dtype=scale.dtype)
    params[:, MHR_POSE_DIM:] = scale
    return params


def batched_view_model_params(
    front_pose: torch.Tensor,
    side_pose: torch.Tensor,
    scale: torch.Tensor,
) -> torch.Tensor:
    """Stack front, side, and canonical 204-vectors for one MHR call."""
    front_model = torch.cat([front_pose, scale], dim=0)
    side_model = torch.cat([side_pose, scale], dim=0)
    canon_model = torch.zeros_like(front_model)
    canon_model[MHR_POSE_DIM:] = scale
    return torch.stack([front_model, side_model, canon_model], dim=0)


def _mhr_cm_to_sam3d_metres(points_cm: torch.Tensor) -> torch.Tensor:
    sign = points_cm.new_tensor([1.0, -1.0, -1.0])
    return (points_cm * sign) / SAM3D_METRES_TO_CM


def _project_points(
    points_cm: torch.Tensor,
    focal: torch.Tensor,
    cam_t_m: torch.Tensor,
    image_hw: tuple[int, int],
) -> torch.Tensor:
    camera = _mhr_cm_to_sam3d_metres(points_cm) + cam_t_m.reshape(1, 3)
    z = camera[:, 2].clamp(min=1e-4)
    height, width = image_hw
    u = focal * camera[:, 0] / z + (width * 0.5)
    v = focal * camera[:, 1] / z + (height * 0.5)
    return torch.stack([u, v], dim=-1)


def _sample_mask(mask: torch.Tensor, pixels: torch.Tensor) -> torch.Tensor:
    height, width = mask.shape[-2], mask.shape[-1]
    x = (pixels[:, 0] / max(width - 1, 1)) * 2.0 - 1.0
    y = (pixels[:, 1] / max(height - 1, 1)) * 2.0 - 1.0
    grid = torch.stack([x, y], dim=-1).reshape(1, 1, -1, 2)
    sampled = F.grid_sample(
        mask.reshape(1, 1, height, width),
        grid,
        mode="bilinear",
        padding_mode="zeros",
        align_corners=True,
    )
    return sampled.reshape(-1)


def _pad_identity(body20: torch.Tensor, hands5: torch.Tensor) -> torch.Tensor:
    identity = torch.zeros(body20.shape[0], MHR_IDENTITY_DIM, device=body20.device, dtype=body20.dtype)
    identity[:, :MHR_BODY_IDENTITY_DIM] = body20
    identity[:, 40:45] = hands5
    return identity


def _require_mhr_centimetres(stature_cm: torch.Tensor, label: str) -> None:
    value = float(stature_cm.reshape(-1)[0].detach().cpu())
    if value < MIN_PLAUSIBLE_STATURE_CM:
        raise RuntimeError(
            f"{label} stature is {value:.3f}; MHR TorchScript output is centimetres. "
            "Refusing a metre-scale mesh."
        )


def silhouette_distance_fields(mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Head-crop-aware outside-distance and valid-weight maps (OpenCV).

    Distance is 0 inside the SAM 2 silhouette and grows outside, capped and
    normalized by the image diagonal so loose clothing is a weak pull.
    Rows at the cropped neck/head band have weight 0 so missing face pixels
    cannot drag the torso.
    """
    import cv2

    binary = (np.asarray(mask) > 0).astype(np.uint8)
    if binary.ndim != 2:
        raise RuntimeError("Silhouette mask must be HxW.")
    height, width = binary.shape
    background = np.where(binary > 0, 0, 255).astype(np.uint8)
    outside = cv2.distanceTransform(background, cv2.DIST_L2, 5).astype(np.float32)
    diagonal = float(np.hypot(height, width))
    cap = max(1.0, SILHOUETTE_DIST_CAP_FRAC * diagonal)
    distance = np.minimum(outside, cap) / max(diagonal, 1.0)

    valid = np.ones((height, width), dtype=np.float32)
    row_counts = binary.sum(axis=1)
    body_rows = np.flatnonzero(row_counts > 0)
    if body_rows.size == 0:
        raise RuntimeError("Silhouette mask is empty; cannot build a distance field.")
    first = int(body_rows[0])
    touches_top = bool(binary[0].any()) or first <= max(2, int(HEAD_CROP_TOP_FRAC * height))
    if touches_top:
        neck = min(height, first + max(6, int(HEAD_CROP_NECK_FRAC * height)))
        valid[:neck, :] = 0.0
    return distance, valid


def project_scale_along_stature_gradient(
    scale: torch.Tensor,
    stature_cm: torch.Tensor,
    stature_grad: torch.Tensor,
    target_height_cm: torch.Tensor,
    adam_delta: torch.Tensor | None = None,
) -> None:
    """In-place: move skeleton params along ∇stature so height matches the statement.

    First-order Newton projection. `adam_delta` is the optimizer step taken
    after `stature_grad` was measured, so the residual accounts for it.
    """
    if not torch.isfinite(stature_cm).all() or not torch.isfinite(stature_grad).all():
        return
    grad_norm_sq = stature_grad.pow(2).sum()
    if float(grad_norm_sq.detach()) < STATURE_GRAD_EPS:
        return
    residual = target_height_cm.reshape(-1)[0].to(dtype=stature_cm.dtype) - stature_cm.reshape(-1)[0]
    if adam_delta is not None and torch.isfinite(adam_delta).all():
        residual = residual - (stature_grad * adam_delta).sum()
    if not torch.isfinite(residual):
        return
    step = stature_grad.detach() * (residual.detach() / grad_norm_sq.detach().clamp(min=STATURE_GRAD_EPS))
    with torch.no_grad():
        scale.add_(step)


def plateau_count_after(
    loss_delta: float,
    param_delta: float,
    previous_count: int,
    current_loss: float,
) -> int:
    rel = LOSS_PLATEAU_REL * max(abs(current_loss), 1.0)
    if loss_delta <= rel and param_delta <= PARAM_PLATEAU_EPS:
        return previous_count + 1
    return 0


def _finite_tensors(*tensors: torch.Tensor) -> bool:
    return all(bool(torch.isfinite(tensor).all().item()) for tensor in tensors)


def native_joint_rmse_cm(predicted: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    """RMSE over 127 native joints, centimetres."""
    delta = (predicted - target).pow(2).sum(dim=-1)
    return torch.sqrt(delta.mean())


def fit_two_view_mhr(
    mhr: torch.nn.Module,
    front: dict[str, Any],
    side: dict[str, Any],
    front_mask: np.ndarray,
    side_mask: np.ndarray,
    height_cm: float,
    weight_kg: float | None,
    device: torch.device,
) -> dict[str, Any]:
    front_params = torch.tensor(pack_model_params(front), device=device)
    side_params = torch.tensor(pack_model_params(side), device=device)
    front_shape = torch.tensor(_finite_1d(front["shape_params"], MHR_IDENTITY_DIM, "front shape_params"), device=device)
    side_shape = torch.tensor(_finite_1d(side["shape_params"], MHR_IDENTITY_DIM, "side shape_params"), device=device)

    body20 = (0.5 * (front_shape[:MHR_BODY_IDENTITY_DIM] + side_shape[:MHR_BODY_IDENTITY_DIM])).clone()
    # Hand identity and per-view poses stay at the SAM 3D Body initializer.
    hands5 = (0.5 * (front_shape[40:45] + side_shape[40:45])).clone()
    scale = (0.5 * (front_params[MHR_POSE_DIM:] + side_params[MHR_POSE_DIM:])).clone()
    front_pose = front_params[:MHR_POSE_DIM].clone()
    side_pose = side_params[:MHR_POSE_DIM].clone()
    if scale.numel() != MHR_SKELETON_DIM:
        raise RuntimeError(
            f"Packed skeleton scale must have {MHR_SKELETON_DIM} values, got {int(scale.numel())}."
        )

    body20.requires_grad_(True)
    scale.requires_grad_(True)

    optimizer = torch.optim.Adam([body20, scale], lr=FIT_LR)
    face = torch.zeros(3, 72, device=device)
    front_k3d = torch.tensor(native_joint_coords_mhr_cm(front), device=device)
    side_k3d = torch.tensor(native_joint_coords_mhr_cm(side), device=device)

    front_dist, front_valid = silhouette_distance_fields(front_mask)
    side_dist, side_valid = silhouette_distance_fields(side_mask)
    front_dist_t = torch.tensor(front_dist, device=device)
    side_dist_t = torch.tensor(side_dist, device=device)
    front_valid_t = torch.tensor(front_valid, device=device)
    side_valid_t = torch.tensor(side_valid, device=device)
    front_mask_t = torch.tensor(front_mask.astype(np.float32), device=device)
    side_mask_t = torch.tensor(side_mask.astype(np.float32), device=device)
    front_focal = torch.tensor(float(np.asarray(front["focal_length"]).reshape(-1)[0]), device=device)
    side_focal = torch.tensor(float(np.asarray(side["focal_length"]).reshape(-1)[0]), device=device)
    front_cam = torch.tensor(_finite_1d(front["pred_cam_t"], 3, "front pred_cam_t"), device=device)
    side_cam = torch.tensor(_finite_1d(side["pred_cam_t"], 3, "side pred_cam_t"), device=device)
    front_hw = (int(front_mask.shape[0]), int(front_mask.shape[1]))
    side_hw = (int(side_mask.shape[0]), int(side_mask.shape[1]))
    target_height = torch.tensor(float(height_cm), device=device, dtype=scale.dtype)

    last_clothing = torch.tensor(1.0, device=device)
    last_silhouette = torch.tensor(0.0, device=device)
    best_loss = float("inf")
    best_body: torch.Tensor | None = None
    best_scale: torch.Tensor | None = None
    prev_loss = float("inf")
    prev_body = body20.detach().clone()
    prev_scale = scale.detach().clone()
    plateau_hits = 0
    completed_steps = 0

    for step in range(FIT_STEPS):
        optimizer.zero_grad(set_to_none=True)
        identity = _pad_identity(body20.unsqueeze(0), hands5.unsqueeze(0)).repeat(3, 1)
        model_params = batched_view_model_params(front_pose, side_pose, scale)
        verts, skel = _forward_mhr(mhr, identity, model_params, face)

        front_joints = skeleton_positions(skel[0:1])[0]
        side_joints = skeleton_positions(skel[1:2])[0]
        keypoint_loss = (
            (front_joints - front_k3d).pow(2).mean()
            + (side_joints - side_k3d).pow(2).mean()
        )

        front_pixels = _project_points(verts[0], front_focal, front_cam, front_hw)
        side_pixels = _project_points(verts[1], side_focal, side_cam, side_hw)
        front_weight = _sample_mask(front_valid_t, front_pixels)
        side_weight = _sample_mask(side_valid_t, side_pixels)
        valid_mass = (front_weight.sum() + side_weight.sum()).clamp(min=1e-6)
        silhouette_loss = (
            (_sample_mask(front_dist_t, front_pixels) * front_weight).sum()
            + (_sample_mask(side_dist_t, side_pixels) * side_weight).sum()
        ) / valid_mass

        front_inside = _sample_mask(front_mask_t, front_pixels)
        side_inside = _sample_mask(side_mask_t, side_pixels)
        occupancy = (
            (front_inside * front_weight).sum() + (side_inside * side_weight).sum()
        ) / valid_mass
        clothing = 1.0 - occupancy

        identity_reg = body20.pow(2).mean()
        loss = (
            KEYPOINT_LOSS_WEIGHT * keypoint_loss
            + SILHOUETTE_LOSS_WEIGHT * silhouette_loss
            + IDENTITY_REG_WEIGHT * identity_reg
        )

        if not _finite_tensors(loss, keypoint_loss, silhouette_loss, clothing):
            break

        stature = skeleton_height_cm(skel[2:3]).reshape(-1)[0]
        stature_grad = torch.autograd.grad(
            stature,
            scale,
            retain_graph=True,
            allow_unused=True,
            create_graph=False,
        )[0]
        if stature_grad is None:
            stature_grad = torch.zeros_like(scale)

        loss.backward()
        if body20.grad is not None and not bool(torch.isfinite(body20.grad).all().item()):
            break
        if scale.grad is not None and not bool(torch.isfinite(scale.grad).all().item()):
            break

        scale_before = scale.detach().clone()
        optimizer.step()
        if not _finite_tensors(body20, scale):
            break
        adam_delta = scale.detach() - scale_before
        with torch.no_grad():
            project_scale_along_stature_gradient(
                scale,
                stature.detach(),
                stature_grad.detach(),
                target_height,
                adam_delta=adam_delta,
            )
            if not _finite_tensors(scale):
                scale.copy_(scale_before)
                if best_body is not None and best_scale is not None:
                    break
                raise RuntimeError("MHR height projection produced non-finite skeleton parameters.")

        completed_steps = step + 1
        loss_value = float(loss.detach())
        if loss_value < best_loss:
            best_loss = loss_value
            best_body = body20.detach().clone()
            best_scale = scale.detach().clone()
            last_clothing = clothing.detach()
            last_silhouette = silhouette_loss.detach()

        param_delta = float(
            (body20.detach() - prev_body).abs().max()
            + (scale.detach() - prev_scale).abs().max()
        )
        plateau_hits = plateau_count_after(
            abs(prev_loss - loss_value) if np.isfinite(prev_loss) else float("inf"),
            param_delta,
            plateau_hits,
            loss_value,
        )
        prev_loss = loss_value
        prev_body = body20.detach().clone()
        prev_scale = scale.detach().clone()
        if step + 1 >= MIN_FIT_STEPS and plateau_hits >= PLATEAU_PATIENCE:
            break

    if best_body is None or best_scale is None:
        raise RuntimeError("Two-view MHR fit produced no finite parameter state.")
    with torch.no_grad():
        body20.copy_(best_body)
        scale.copy_(best_scale)

    with torch.no_grad():
        identity_row = _pad_identity(body20.unsqueeze(0), hands5.unsqueeze(0))
        identity = identity_row.repeat(3, 1)
        model_params = batched_view_model_params(front_pose, side_pose, scale)
        verts, skel = _forward_mhr(mhr, identity, model_params, face)
        vertices = verts[2]
        if vertices.shape[0] != MHR_VERTEX_COUNT:
            raise RuntimeError(
                f"MHR LOD 1 must have {MHR_VERTEX_COUNT} vertices, got {vertices.shape[0]}. "
                "Refusing to stamp a different topology."
            )

        stature = mesh_stature_cm(verts[2:3])
        _require_mhr_centimetres(stature, "Canonical MHR mesh")
        vertices_cm = vertices
        canon_skel = skel[2:3]
        canon_joints = skeleton_positions(canon_skel)[0]
        girths = measure_chest_waist_hip_cm(
            vertices_cm.detach().cpu().numpy(),
            canon_joints.detach().cpu().numpy(),
        )
        height_hat = float(skeleton_height_cm(canon_skel)[0].cpu())
        quats = F.normalize(skeleton_quaternions(canon_skel)[0], p=2, dim=-1)
        joint_rotations = quats.detach().cpu().numpy().astype(np.float32).reshape(-1)
        if joint_rotations.shape[0] != MHR_JOINT_QUAT_DIM:
            raise RuntimeError(
                f"Canonical joint_rotations must have {MHR_JOINT_QUAT_DIM} xyzw values, "
                f"got {joint_rotations.shape[0]}."
            )

        front_joints = skeleton_positions(skel[0:1])[0]
        side_joints = skeleton_positions(skel[1:2])[0]
        joint_rmse = 0.5 * (
            native_joint_rmse_cm(front_joints, front_k3d)
            + native_joint_rmse_cm(side_joints, side_k3d)
        )
        front_pixels = _project_points(verts[0], front_focal, front_cam, front_hw)
        side_pixels = _project_points(verts[1], side_focal, side_cam, side_hw)
        front_weight = _sample_mask(front_valid_t, front_pixels)
        side_weight = _sample_mask(side_valid_t, side_pixels)
        valid_mass = (front_weight.sum() + side_weight.sum()).clamp(min=1e-6)
        silhouette_residual = (
            (_sample_mask(front_dist_t, front_pixels) * front_weight).sum()
            + (_sample_mask(side_dist_t, side_pixels) * side_weight).sum()
        ) / valid_mass
        occupancy = (
            (_sample_mask(front_mask_t, front_pixels) * front_weight).sum()
            + (_sample_mask(side_mask_t, side_pixels) * side_weight).sum()
        ) / valid_mass
        clothing = 1.0 - occupancy
        if not _finite_tensors(joint_rmse, silhouette_residual, clothing):
            joint_rmse = torch.tensor(float("nan"), device=device)
            silhouette_residual = last_silhouette
            clothing = last_clothing

        serialize_started = time.perf_counter()
        identity_np = identity_row[0].detach().cpu().numpy().tolist()
        scale_np = scale.detach().cpu().numpy().tolist()
        pose_np = model_params[2].detach().cpu().numpy().tolist()
        height_residual = abs(height_hat - float(height_cm))
        result: dict[str, Any] = {
            "topology_version": MHR_TOPOLOGY_VERSION,
            "shape": identity_np,
            "skeleton": scale_np,
            "pose": pose_np,
            "joint_rotations": joint_rotations.tolist(),
            "derived_measurements": girths,
            "vertex_positions": vertices_cm.detach().cpu().numpy().astype(np.float32).reshape(-1).tolist(),
            "height_residual_cm": height_residual,
            "clothing_residual": float(clothing.detach().cpu()),
            "joint_count": int(MHR_JOINT_COUNT),
            "vertex_count": int(MHR_VERTEX_COUNT),
        }
        if weight_kg is not None:
            result["stated_weight_kg"] = float(weight_kg)
        merge_fit_diagnostics(
            result,
            iteration_count=completed_steps,
            native_joint_rmse_cm=float(joint_rmse.detach().cpu()),
            height_residual_cm=height_residual,
            silhouette_residual=float(silhouette_residual.detach().cpu()),
            stage_timings_ms={"serialization": elapsed_ms(serialize_started)},
        )
        return result
