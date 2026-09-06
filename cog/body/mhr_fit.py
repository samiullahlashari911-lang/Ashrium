"""Joint two-view MHR fit. Shared identity (20 body) + shared skeleton (68); per-view pose."""

from __future__ import annotations

from typing import Any

import numpy as np
import torch
import torch.nn.functional as F

from .girths import measure_chest_waist_hip_cm
from .topology import (
    MHR_BODY_IDENTITY_DIM,
    MHR_IDENTITY_DIM,
    MHR_JOINT_COUNT,
    MHR_MODEL_PARAM_DIM,
    MHR_POSE_DIM,
    MHR_SKELETON_DIM,
    MHR_TOPOLOGY_VERSION,
    MHR_VERTEX_COUNT,
)

KEYPOINT_LOSS_WEIGHT = 1.0
SILHOUETTE_LOSS_WEIGHT = 0.05
IDENTITY_REG_WEIGHT = 0.01
HEIGHT_LOSS_WEIGHT = 25.0
FIT_STEPS = 60
FIT_LR = 0.04


def _as_1d(value: Any, length: int | None = None) -> np.ndarray:
    array = np.asarray(value, dtype=np.float32).reshape(-1)
    if length is not None:
        padded = np.zeros(length, dtype=np.float32)
        padded[: min(length, array.shape[0])] = array[: min(length, array.shape[0])]
        return padded
    return array


def pack_model_params(person: dict[str, Any]) -> np.ndarray:
    if "mhr_model_params" in person:
        packed = _as_1d(person["mhr_model_params"], MHR_MODEL_PARAM_DIM)
        if packed.shape[0] == MHR_MODEL_PARAM_DIM:
            return packed

    translation_cm = _as_1d(person["pred_cam_t"], 3) * 100.0
    global_rot = _as_1d(person["global_rot"], 3)
    body_pose = _as_1d(person["body_pose_params"], 130)
    scale = _as_1d(person["scale_params"], MHR_SKELETON_DIM)
    return np.concatenate([translation_cm, global_rot, body_pose, scale]).astype(np.float32)


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


def _skeleton_positions(skel_state: torch.Tensor) -> torch.Tensor:
    if skel_state.ndim == 3:
        return skel_state[..., -3:]
    raise RuntimeError(f"Unexpected MHR skeleton_state shape {tuple(skel_state.shape)}")


def skeleton_height_cm(skel_state: torch.Tensor) -> torch.Tensor:
    positions = _skeleton_positions(skel_state)
    spans = positions.amax(dim=-2) - positions.amin(dim=-2)
    return spans.amax(dim=-1)


def mesh_stature_cm(vertices: torch.Tensor) -> torch.Tensor:
    spans = vertices.amax(dim=-2) - vertices.amin(dim=-2)
    return spans.amax(dim=-1)


def _maybe_to_cm(extent: torch.Tensor) -> torch.Tensor:
    # MHR documents centimetres; SAM 3D Body meshes are metres. Detect once.
    return torch.where(extent < 8.0, extent * 100.0, extent)


def canonical_model_params(scale: torch.Tensor) -> torch.Tensor:
    params = torch.zeros(scale.shape[0], MHR_MODEL_PARAM_DIM, device=scale.device, dtype=scale.dtype)
    params[:, MHR_POSE_DIM:] = scale
    return params


def _project_points(
    points_cm: torch.Tensor,
    focal: torch.Tensor,
    cam_t_m: torch.Tensor,
    image_hw: tuple[int, int],
) -> torch.Tensor:
    points_m = points_cm / 100.0
    translation = cam_t_m.reshape(1, 3)
    camera = points_m + translation
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
    front_params = torch.tensor(pack_model_params(front), device=device).unsqueeze(0)
    side_params = torch.tensor(pack_model_params(side), device=device).unsqueeze(0)
    front_shape = torch.tensor(_as_1d(front["shape_params"], MHR_IDENTITY_DIM), device=device)
    side_shape = torch.tensor(_as_1d(side["shape_params"], MHR_IDENTITY_DIM), device=device)

    body20 = (0.5 * (front_shape[:MHR_BODY_IDENTITY_DIM] + side_shape[:MHR_BODY_IDENTITY_DIM])).clone()
    hands5 = (0.5 * (front_shape[40:45] + side_shape[40:45])).clone()
    scale = (0.5 * (front_params[0, MHR_POSE_DIM:] + side_params[0, MHR_POSE_DIM:])).clone()
    front_pose = front_params[0, :MHR_POSE_DIM].clone()
    side_pose = side_params[0, :MHR_POSE_DIM].clone()

    body20.requires_grad_(True)
    hands5.requires_grad_(True)
    scale.requires_grad_(True)
    front_pose.requires_grad_(True)
    side_pose.requires_grad_(True)

    optimizer = torch.optim.Adam([body20, hands5, scale, front_pose, side_pose], lr=FIT_LR)
    face = torch.zeros(1, 72, device=device)
    front_k3d = torch.tensor(_as_1d(front["pred_keypoints_3d"]).reshape(-1, 3), device=device)
    side_k3d = torch.tensor(_as_1d(side["pred_keypoints_3d"]).reshape(-1, 3), device=device)
    if front_k3d.abs().mean() < 8:
        front_k3d = front_k3d * 100.0
    if side_k3d.abs().mean() < 8:
        side_k3d = side_k3d * 100.0

    front_mask_t = torch.tensor(front_mask.astype(np.float32), device=device)
    side_mask_t = torch.tensor(side_mask.astype(np.float32), device=device)
    front_focal = torch.tensor(float(np.asarray(front["focal_length"]).reshape(-1)[0]), device=device)
    side_focal = torch.tensor(float(np.asarray(side["focal_length"]).reshape(-1)[0]), device=device)
    front_cam = torch.tensor(_as_1d(front["pred_cam_t"], 3), device=device)
    side_cam = torch.tensor(_as_1d(side["pred_cam_t"], 3), device=device)
    front_hw = (int(front_mask.shape[0]), int(front_mask.shape[1]))
    side_hw = (int(side_mask.shape[0]), int(side_mask.shape[1]))
    target_height = torch.tensor([float(height_cm)], device=device)

    last_clothing = torch.tensor(1.0, device=device)

    for _step in range(FIT_STEPS):
        optimizer.zero_grad(set_to_none=True)
        identity = _pad_identity(body20.unsqueeze(0), hands5.unsqueeze(0))
        front_model = torch.cat([front_pose, scale], dim=0).unsqueeze(0)
        side_model = torch.cat([side_pose, scale], dim=0).unsqueeze(0)

        front_verts, front_skel = _forward_mhr(mhr, identity, front_model, face)
        side_verts, side_skel = _forward_mhr(mhr, identity, side_model, face)
        canon_verts, canon_skel = _forward_mhr(mhr, identity, canonical_model_params(scale.unsqueeze(0)), face)

        front_joints = _skeleton_positions(front_skel)[0]
        side_joints = _skeleton_positions(side_skel)[0]
        joint_count = min(front_joints.shape[0], front_k3d.shape[0], side_k3d.shape[0])
        keypoint_loss = (
            (front_joints[:joint_count] - front_k3d[:joint_count]).pow(2).mean()
            + (side_joints[:joint_count] - side_k3d[:joint_count]).pow(2).mean()
        )

        front_pixels = _project_points(front_verts[0], front_focal, front_cam, front_hw)
        side_pixels = _project_points(side_verts[0], side_focal, side_cam, side_hw)
        front_inside = _sample_mask(front_mask_t, front_pixels)
        side_inside = _sample_mask(side_mask_t, side_pixels)
        clothing = 1.0 - 0.5 * (front_inside.mean() + side_inside.mean())
        last_clothing = clothing.detach()
        silhouette_loss = clothing

        height = _maybe_to_cm(skeleton_height_cm(canon_skel))
        height_loss = (height - target_height).pow(2).mean()
        identity_reg = body20.pow(2).mean() + hands5.pow(2).mean()

        loss = (
            KEYPOINT_LOSS_WEIGHT * keypoint_loss
            + SILHOUETTE_LOSS_WEIGHT * silhouette_loss
            + HEIGHT_LOSS_WEIGHT * height_loss
            + IDENTITY_REG_WEIGHT * identity_reg
        )
        loss.backward()
        optimizer.step()

        with torch.no_grad():
            # Hard height constraint: rescale skeleton so canonical stature matches stated height.
            identity = _pad_identity(body20.unsqueeze(0), hands5.unsqueeze(0))
            _, canon_skel = _forward_mhr(mhr, identity, canonical_model_params(scale.unsqueeze(0)), face)
            current = _maybe_to_cm(skeleton_height_cm(canon_skel)).clamp(min=1.0)
            scale.mul_((target_height / current).reshape(-1)[0])

    with torch.no_grad():
        identity = _pad_identity(body20.unsqueeze(0), hands5.unsqueeze(0))
        canon_params = canonical_model_params(scale.unsqueeze(0))
        canon_verts, canon_skel = _forward_mhr(mhr, identity, canon_params, face)
        vertices = canon_verts[0]
        if vertices.shape[0] != MHR_VERTEX_COUNT:
            raise RuntimeError(
                f"MHR LOD 1 must have {MHR_VERTEX_COUNT} vertices, got {vertices.shape[0]}. "
                "Refusing to stamp a different topology."
            )

        vertices_cm = vertices
        stature = _maybe_to_cm(mesh_stature_cm(canon_verts))
        if float(stature[0]) > 8 and float((vertices.max() - vertices.min()).abs()) < 8:
            vertices_cm = vertices * 100.0
        elif float(stature[0]) < 8:
            vertices_cm = vertices * 100.0

        girths = measure_chest_waist_hip_cm(vertices_cm.detach().cpu().numpy())
        height_hat = float(_maybe_to_cm(skeleton_height_cm(canon_skel))[0].cpu())
        joints = _skeleton_positions(canon_skel)[0].detach().cpu().numpy().reshape(-1)

        identity_np = identity[0].detach().cpu().numpy().tolist()
        scale_np = scale.detach().cpu().numpy().tolist()
        pose_np = canon_params[0].detach().cpu().numpy().tolist()
        result: dict[str, Any] = {
            "topology_version": MHR_TOPOLOGY_VERSION,
            "shape": identity_np,
            "skeleton": scale_np,
            "pose": pose_np,
            "joint_rotations": joints.astype(np.float32).tolist(),
            "derived_measurements": girths,
            "vertex_positions": vertices_cm.detach().cpu().numpy().astype(np.float32).reshape(-1).tolist(),
            "height_residual_cm": abs(height_hat - float(height_cm)),
            "clothing_residual": float(last_clothing.cpu()),
            "joint_count": int(MHR_JOINT_COUNT),
            "vertex_count": int(MHR_VERTEX_COUNT),
        }
        if weight_kg is not None:
            result["stated_weight_kg"] = float(weight_kg)
        return result
