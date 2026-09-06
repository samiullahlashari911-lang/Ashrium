"""Newton SolverXPBD cloth on a kinematic MHR LOD 3 mesh (Apache 2.0)."""

from __future__ import annotations

from typing import Any

import numpy as np

from .clearance import clearance_cm, vertex_strain

MAX_FRAMES = 80
SUBSTEPS = 8
FRAME_DT = 1.0 / 60.0
DISPLACEMENT_EPS_M = 8e-5
CLEARANCE_EPS_CM = 0.08


def _y_up_to_z_up(points: np.ndarray) -> np.ndarray:
    swapped = np.empty_like(points)
    swapped[:, 0] = points[:, 0]
    swapped[:, 1] = points[:, 2]
    swapped[:, 2] = points[:, 1]
    return swapped


def _z_up_to_y_up(points: np.ndarray) -> np.ndarray:
    return _y_up_to_z_up(points)


def _mean_abs_delta(previous: np.ndarray, current: np.ndarray) -> float:
    return float(np.mean(np.linalg.norm(current - previous, axis=1)))


def drape_newton_xpbd(
    cloth_rest: np.ndarray,
    cloth_indices: np.ndarray,
    pin_mask: np.ndarray,
    collider_positions: np.ndarray,
    collider_indices: np.ndarray,
    mechanical: dict[str, float],
) -> dict[str, Any]:
    """Run Newton XPBD. Inputs and outputs are metres, Y-up (Three.js)."""

    import warp as wp
    import newton

    wp.init()
    if not wp.is_cuda_available():
        raise RuntimeError("task=drape requires CUDA (gpu-a100-large).")
    wp.set_device("cuda:0")

    cloth_z = _y_up_to_z_up(cloth_rest)
    collider_z = _y_up_to_z_up(collider_positions)
    density = max(float(mechanical["area_density"]), 1e-4)
    tensile = max(float(mechanical["tensile_stiffness"]), 1.0)
    bending = max(float(mechanical["bending_rigidity"]), 1e-5)
    shear = max(float(mechanical["shear_stiffness"]), 1.0)

    builder = newton.ModelBuilder()
    try:
        mesh = newton.Mesh(
            collider_z.astype(np.float32),
            collider_indices.astype(np.int32),
            compute_inertia=False,
        )
    except TypeError:
        mesh = newton.Mesh(collider_z.astype(np.float32), collider_indices.astype(np.int32))
    if hasattr(mesh, "build_sdf"):
        mesh.build_sdf(max_resolution=48)

    builder.add_shape_mesh(-1, mesh=mesh)
    cloth_vertices = [wp.vec3(float(vertex[0]), float(vertex[1]), float(vertex[2])) for vertex in cloth_z]
    try:
        builder.add_cloth_mesh(
            pos=wp.vec3(0.0, 0.0, 0.0),
            rot=wp.quat_identity(),
            scale=1.0,
            vel=wp.vec3(0.0, 0.0, 0.0),
            vertices=cloth_vertices,
            indices=cloth_indices.astype(np.int32).tolist(),
            density=density,
            tri_ke=tensile,
            tri_ka=tensile,
            tri_kd=max(tensile * 0.01, 0.1),
            edge_ke=bending * 5_000.0,
            edge_kd=1.0,
            add_springs=True,
            spring_ke=tensile,
            spring_kd=1.0,
            particle_radius=0.006,
        )
    except TypeError:
        builder.add_cloth_mesh(
            pos=wp.vec3(0.0, 0.0, 0.0),
            rot=wp.quat_identity(),
            scale=1.0,
            vel=wp.vec3(0.0, 0.0, 0.0),
            vertices=cloth_z.astype(np.float32),
            indices=cloth_indices.astype(np.int32),
            density=density,
            add_springs=True,
            spring_ke=tensile,
        )

    model = builder.finalize()
    model.gravity = wp.vec3(0.0, 0.0, -9.81)
    model.soft_contact_ke = 1.0e2
    model.soft_contact_kd = 1.0e0
    model.soft_contact_mu = 0.35

    masses = model.particle_mass.numpy()
    cloth_count = cloth_rest.shape[0]
    if masses.shape[0] < cloth_count:
        raise RuntimeError("Newton cloth particle count is smaller than the rest mesh.")
    masses[:cloth_count][pin_mask] = 0.0
    model.particle_mass.assign(masses)

    solver = newton.solvers.SolverXPBD(model, iterations=8)
    collision_pipeline = newton.CollisionPipeline(model)
    contacts = collision_pipeline.contacts()
    state_0 = model.state()
    state_1 = model.state()
    control = model.control()
    dt = FRAME_DT / SUBSTEPS

    previous = state_0.particle_q.numpy()[:cloth_count].copy()
    previous_clearance = clearance_cm(_z_up_to_y_up(previous), collider_positions)
    frames_run = 0

    for _frame in range(MAX_FRAMES):
        for _ in range(SUBSTEPS):
            state_0.clear_forces()
            collision_pipeline.collide(state_0, contacts)
            solver.step(state_0, state_1, control, contacts, dt)
            state_0, state_1 = state_1, state_0
        frames_run += 1
        current = state_0.particle_q.numpy()[:cloth_count]
        draped_y = _z_up_to_y_up(current)
        current_clearance = clearance_cm(draped_y, collider_positions)
        displacement = _mean_abs_delta(previous, current)
        clearance_delta = float(np.mean(np.abs(current_clearance - previous_clearance)))
        previous = current.copy()
        previous_clearance = current_clearance
        if displacement < DISPLACEMENT_EPS_M and clearance_delta < CLEARANCE_EPS_CM and frames_run >= 12:
            break

    draped = _z_up_to_y_up(state_0.particle_q.numpy()[:cloth_count].astype(np.float32))
    rest = cloth_rest.astype(np.float32)
    delta = (draped - rest).astype(np.float32)
    strain = vertex_strain(rest, draped, cloth_indices)
    clearances = clearance_cm(draped, collider_positions)
    mean_strain = float(np.mean(np.abs(strain))) if strain.size else 0.0

    return {
        "rest_positions": rest.reshape(-1).tolist(),
        "delta": delta.reshape(-1).tolist(),
        "strain": strain.tolist(),
        "clearance_cm": clearances.tolist(),
        "indices": cloth_indices.astype(int).tolist(),
        "vertex_count": int(rest.shape[0]),
        "mean_strain": mean_strain,
        "frames": frames_run,
        "collider_vertex_count": int(collider_positions.shape[0]),
    }
