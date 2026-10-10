"""Newton SolverStyle3D drape of a sewn garment on the rigid MHR LOD 3 body (Apache 2.0).

The garment arrives welded (stitches closed) with its rest shape taken from
the 2D GarmentCode panels, so the solver pulls the seams and panels into the
real garment shape. Phase 1 runs without gravity so the sewn garment settles
around the body; phase 2 turns gravity on until the cloth stops moving.
Inputs and outputs are metres, Y-up (Three.js); Newton runs Z-up.
"""

from __future__ import annotations

import base64
import os
import time
from typing import Any, Callable

import numpy as np

FPS = 60
SUBSTEPS = 4
ITERATIONS = 10
SEW_FRAMES = 20
MIN_SETTLE_FRAMES = 45
MAX_SETTLE_FRAMES = 240
# Settled when 95% of the cloth moves under 0.2 mm per frame (12 mm/s): a
# mean let a still torso hide sleeves that were still dropping.
SETTLE_EPS_M = 2.0e-4
DIVERGED_M = 3.0
GRAVITY = -9.81
COLLISION_RADIUS_M = 3.5e-3
SOFT_CONTACT_KE = 5.0e3
SOFT_CONTACT_MU = 0.3
SOFT_CONTACT_MARGIN_M = 0.01
# KES-mapped catalog values (cotton 90 / 45 / 0.04). Drape look only, never
# the size. Bending is KES B in gf*cm^2/cm; 1 gf*cm^2/cm = 9.81e-5 N*m, which
# lands Newton's Style3D jacket example (B ~0.2-0.4) at its 1e-5-4e-5. The
# earlier 1e-3 scale made a cotton tee ~10x too stiff: boxy sleeves.
STRETCH_SCALE = 10.0
BEND_SCALE = 9.81e-5


def _y_to_z(points: np.ndarray) -> np.ndarray:
    """Rotate Y-up to Z-up (+90 deg about X). A plain y/z swap is a mirror: it
    turns the body mesh inside out, so the cloth falls through it."""
    out = np.empty_like(points)
    out[:, 0] = points[:, 0]
    out[:, 1] = -points[:, 2]
    out[:, 2] = points[:, 1]
    return out


def _z_to_y(points: np.ndarray) -> np.ndarray:
    out = np.empty_like(points)
    out[:, 0] = points[:, 0]
    out[:, 1] = points[:, 2]
    out[:, 2] = -points[:, 1]
    return out


def encode_frame(points_y_up: np.ndarray) -> str:
    return base64.b64encode(points_y_up.astype(np.float16).tobytes()).decode("ascii")


def style3d_stiffness(mechanical: dict[str, float]) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    tensile = max(float(mechanical["tensile_stiffness"]), 1.0) * STRETCH_SCALE
    shear = max(float(mechanical["shear_stiffness"]), 1.0) * STRETCH_SCALE
    bend = max(float(mechanical["bending_rigidity"]), 1e-4) * BEND_SCALE
    return (tensile, tensile, shear), (bend, bend, bend)


def drape_style3d(
    welded_positions: np.ndarray,
    welded_triangles: np.ndarray,
    panel_uv: np.ndarray,
    panel_triangles: np.ndarray,
    collider_positions: np.ndarray,
    collider_indices: np.ndarray,
    mechanical: dict[str, float],
    record_every: int = 0,
    on_frame: Callable[[int], None] | None = None,
    substeps: int = SUBSTEPS,
    sew_frames: int = SEW_FRAMES,
    use_graph: bool = True,
    min_settle_frames: int = MIN_SETTLE_FRAMES,
    max_settle_frames: int = MAX_SETTLE_FRAMES,
    settle_eps_m: float = SETTLE_EPS_M,
    contact_mu: float = SOFT_CONTACT_MU,
    bend_multiplier: float = 1.0,
    stretch_multiplier: float = 1.0,
    iterations: int = ITERATIONS,
) -> dict[str, Any]:
    import warp as wp
    import newton
    from newton.solvers import style3d

    timings: dict[str, float] = {}
    started = time.perf_counter()
    cache_dir = os.environ.get("ASHRIUM_WARP_CACHE", "").strip()
    if cache_dir:
        # Compiled Warp/Newton kernels on the weights Volume: a new container
        # skips the ~55 s first-drape compile.
        wp.config.kernel_cache_dir = cache_dir
    wp.init()
    if not wp.is_cuda_available():
        raise RuntimeError("task=drape requires CUDA.")
    wp.set_device("cuda:0")

    corners = panel_uv[panel_triangles.reshape(-1, 3)]
    signed = (corners[:, 1, 0] - corners[:, 0, 0]) * (corners[:, 2, 1] - corners[:, 0, 1]) - (
        corners[:, 1, 1] - corners[:, 0, 1]
    ) * (corners[:, 2, 0] - corners[:, 0, 0])
    if not bool((signed > 0).all()):
        # Style3D drops these silently: the garment would lose whole panels.
        raise RuntimeError(f"{int((signed <= 0).sum())} pattern triangles are inverted or flat.")

    stretch, bend = style3d_stiffness(mechanical)
    stretch = tuple(value * stretch_multiplier for value in stretch)
    bend = tuple(value * bend_multiplier for value in bend)
    builder = newton.ModelBuilder()
    newton.solvers.SolverStyle3D.register_custom_attributes(builder)
    body_mesh = newton.Mesh(
        _y_to_z(collider_positions).astype(np.float32),
        collider_indices.astype(np.int32).reshape(-1),
        compute_inertia=False,
    )
    builder.add_shape_mesh(-1, mesh=body_mesh)
    style3d.add_cloth_mesh(
        builder,
        pos=wp.vec3(0.0, 0.0, 0.0),
        rot=wp.quat_identity(),
        vel=wp.vec3(0.0, 0.0, 0.0),
        vertices=_y_to_z(welded_positions).astype(np.float32).tolist(),
        indices=welded_triangles.astype(np.int32).reshape(-1).tolist(),
        panel_verts=panel_uv.astype(np.float32).tolist(),
        panel_indices=panel_triangles.astype(np.int32).reshape(-1).tolist(),
        density=max(float(mechanical["area_density"]), 0.02),
        tri_aniso_ke=wp.vec3(*stretch),
        edge_aniso_ke=wp.vec3(*bend),
        particle_radius=COLLISION_RADIUS_M,
    )
    model = builder.finalize()
    model.soft_contact_ke = SOFT_CONTACT_KE
    model.soft_contact_mu = contact_mu

    cloth_count = int(welded_positions.shape[0])
    if model.particle_count != cloth_count:
        raise RuntimeError(
            f"Style3D kept {model.particle_count} of {cloth_count} garment vertices."
        )

    solver = newton.solvers.SolverStyle3D(model=model, iterations=iterations)
    solver.collision.radius = COLLISION_RADIUS_M
    pipeline = newton.CollisionPipeline(model, soft_contact_margin=SOFT_CONTACT_MARGIN_M)
    contacts = pipeline.contacts()
    control = model.control()
    states = [model.state(), model.state()]
    if substeps % 2:
        raise RuntimeError("substeps must be even: the state swap must end where it began.")
    dt = 1.0 / FPS / substeps

    def set_gravity(value: float) -> None:
        # In place: a captured CUDA graph keeps reading the same array.
        model.gravity.assign(np.array([[0.0, 0.0, value]] * model.gravity.shape[0], dtype=np.float32))

    def simulate() -> None:
        solver.rebuild_bvh(states[0])
        for _ in range(substeps):
            pipeline.collide(states[0], contacts)
            solver.step(states[0], states[1], control, contacts, dt)
            states[0], states[1] = states[1], states[0]

    set_gravity(0.0)
    graph = None
    if use_graph:
        # One frame recorded once and replayed: no per-kernel Python launch cost.
        try:
            with wp.ScopedCapture() as capture:
                simulate()
            graph = capture.graph
        except Exception as error:  # fall back to plain launches, still correct
            print(f"Style3D CUDA graph capture failed, running uncaptured: {error}", flush=True)
            graph = None
    timings["build_ms"] = (time.perf_counter() - started) * 1000.0

    frames: list[str] = []
    frame_phase: list[str] = []
    frame_contacts: list[int] = []
    previous = states[0].particle_q.numpy().copy()
    if record_every > 0:
        frames.append(encode_frame(_z_to_y(previous)))
        frame_phase.append("sewn")

    total_frames = 0
    settle_frames = 0
    converged = False
    phase_started = time.perf_counter()
    displacement = float("inf")
    for frame in range(sew_frames + max_settle_frames):
        if frame == sew_frames:
            wp.synchronize()
            timings["sew_ms"] = (time.perf_counter() - phase_started) * 1000.0
            phase_started = time.perf_counter()
            set_gravity(GRAVITY)
        # substeps is even, so states[0] holds the latest positions after each frame.
        if graph is not None:
            wp.capture_launch(graph)
        else:
            simulate()
        total_frames += 1
        current = states[0].particle_q.numpy()
        if not np.isfinite(current).all() or float(np.abs(current).max()) > DIVERGED_M:
            raise RuntimeError(f"Style3D drape diverged at frame {frame}.")
        displacement = float(np.percentile(np.linalg.norm(current - previous, axis=1), 95))
        previous = current.copy()
        phase = "sew" if frame < sew_frames else "settle"
        if phase == "settle":
            settle_frames += 1
        if record_every > 0 and (frame % record_every == 0):
            frames.append(encode_frame(_z_to_y(current)))
            frame_phase.append(phase)
            frame_contacts.append(int(contacts.soft_contact_count.numpy()[0]))
        if on_frame is not None:
            on_frame(frame)
        if phase == "settle" and settle_frames >= min_settle_frames and displacement < settle_eps_m:
            converged = True
            break
    wp.synchronize()
    timings["settle_ms"] = (time.perf_counter() - phase_started) * 1000.0
    timings["total_ms"] = (time.perf_counter() - started) * 1000.0

    draped = _z_to_y(states[0].particle_q.numpy()).astype(np.float32)
    if record_every > 0:
        frames.append(encode_frame(draped))
        frame_phase.append("settled" if converged else "stopped")
    return {
        "positions": draped,
        "frames": frames,
        "frame_phase": frame_phase,
        "frame_contacts": frame_contacts,
        "shape_flags": [int(flag) for flag in model.shape_flags.numpy()],
        "soft_contact_max": int(contacts.soft_contact_max),
        "frames_run": total_frames,
        "converged": converged,
        "final_displacement_m": displacement,
        "timings_ms": {key: round(value, 1) for key, value in timings.items()},
        "stiffness": {"stretch": stretch, "bend": bend},
        "solver": {
            "substeps": substeps, "sew_frames": sew_frames, "cuda_graph": graph is not None,
            "iterations": iterations, "contact_mu": contact_mu, "settle_eps_m": settle_eps_m,
            "min_settle_frames": min_settle_frames, "max_settle_frames": max_settle_frames,
        },
    }
