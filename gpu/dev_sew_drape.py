"""Dev-only: sew a real GarmentCode garment and drape it on a test body, recording frames.

Ephemeral (`modal run`, never deployed); production is untouched. From the repo root:

    python -m modal run gpu/dev_sew_drape.py --body tmp/avatar-e2e/body-result.json \
        --out tmp/avatar-e2e/sew-drape-result.json

Writes the pattern, the sewn mesh at every stage, the recorded simulation
frames, and per-stage timings for the playback viewer.
"""

from __future__ import annotations

import json
import os
import sys
import time

import modal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from modal_app import image  # noqa: E402  (same image as production)

dev = modal.App("ashrium-dev-sew-drape")

CREWNECK_TEXT = "Men's Crewneck Short Sleeve T-Shirt / Black. 95% cotton, 5% spandex."
CREWNECK_CHART = [
    {"sizeCode": "S", "chestCm": 100.1, "lengthCm": 62},
    {"sizeCode": "M", "chestCm": 104.9, "lengthCm": 64},
    {"sizeCode": "L", "chestCm": 110.0, "lengthCm": 65},
    {"sizeCode": "XL", "chestCm": 114.0, "lengthCm": 67.1},
]
CREWNECK_MECHANICAL = {
    "tensile_stiffness": 85.9,
    "bending_rigidity": 0.0384,
    "shear_stiffness": 43.25,
    "area_density": 0.18,
}


@dev.function(image=image, gpu=["A100-80GB", "A100-40GB", "L40S"], timeout=900)
def sew_and_drape(
    product_text: str,
    size_chart: str,
    category: str,
    size_code: str,
    collider_positions: list[float],
    collider_indices: list[int],
    mechanical: dict[str, float],
    record_every: int,
    repeat: int = 1,
    solver: dict | None = None,
) -> dict:
    import numpy as np

    if "/opt/ashrium" not in sys.path:
        sys.path.insert(0, "/opt/ashrium")
    from drape.arrange import arrange_on_body
    from drape.clearance import clearance_cm
    from drape.newton_style3d import drape_style3d
    from pattern.instantiate import instantiate_patterns

    timings: dict[str, float] = {}
    started = time.perf_counter()
    chart = [entry for entry in json.loads(size_chart) if entry["sizeCode"] == size_code]
    pattern = instantiate_patterns(category, product_text, json.dumps(chart), sew=True)
    timings["pattern_and_sew_ms"] = (time.perf_counter() - started) * 1000.0
    if pattern["status"] != "ok":
        return {"status": pattern["status"], "reason": pattern["unsupported_reason"]}
    rest = pattern["meshes"][0]
    garment = rest.pop("garment_mesh")

    body = np.asarray(collider_positions, dtype=np.float64).reshape(-1, 3)
    faces = np.asarray(collider_indices, dtype=np.int64).reshape(-1, 3)
    step = time.perf_counter()
    arranged = arrange_on_body(garment, body, faces)
    timings["arrange_ms"] = (time.perf_counter() - step) * 1000.0

    uv = np.asarray(garment["uv"], dtype=np.float64).reshape(-1, 2)
    staged = {
        "status": "ok",
        "size": size_code,
        "pattern_girths": rest["pattern_girths"],
        "garment": garment,
        "placed_positions": arranged["placed_positions"].astype(np.float32).reshape(-1).tolist(),
        "welded_id": arranged["welded_id"].tolist(),
        "welded_triangles": arranged["welded_triangles"].reshape(-1).tolist(),
        "panel_triangles": arranged["panel_triangles"].reshape(-1).tolist(),
        "sewn_positions": arranged["welded_positions"].astype(np.float32).reshape(-1).tolist(),
        "arrange": arranged["diagnostics"],
    }
    cold_timings = None
    step = time.perf_counter()
    try:
        # repeat > 1: later runs reuse compiled Warp kernels, like a warm container.
        for attempt in range(max(1, repeat)):
            if attempt > 0:
                cold_timings = drape["timings_ms"]
                step = time.perf_counter()
            drape = drape_style3d(
                welded_positions=arranged["welded_positions"],
                welded_triangles=arranged["welded_triangles"],
                panel_uv=arranged["rest_uv"],
                panel_triangles=arranged["panel_triangles"],
                collider_positions=body.astype(np.float32),
                collider_indices=faces.astype(np.int32),
                mechanical=mechanical,
                record_every=record_every,
                **(solver or {}),
            )
    except Exception as error:  # dev harness: keep the sewn mesh for diagnosis
        import traceback

        timings["total_ms"] = (time.perf_counter() - started) * 1000.0
        return {**staged, "status": "drape_failed", "reason": f"{error}",
                "traceback": traceback.format_exc()[-3000:],
                "timings_ms": {key: round(value, 1) for key, value in timings.items()}}
    timings["drape_ms"] = (time.perf_counter() - step) * 1000.0
    timings["total_ms"] = (time.perf_counter() - started) * 1000.0

    draped = drape["positions"]
    clearance = clearance_cm(draped, body.astype(np.float32))
    return {
        **staged,
        "frames": drape["frames"],
        "frame_phase": drape["frame_phase"],
        "frame_contacts": drape["frame_contacts"],
        "shape_flags": drape["shape_flags"],
        "soft_contact_max": drape["soft_contact_max"],
        "frames_run": drape["frames_run"],
        "converged": drape["converged"],
        "final_displacement_m": drape["final_displacement_m"],
        "drape_timings_ms": drape["timings_ms"],
        "cold_drape_timings_ms": cold_timings,
        "solver": drape["solver"],
        "stiffness": drape["stiffness"],
        "timings_ms": {key: round(value, 1) for key, value in timings.items()},
        "draped_positions": draped.reshape(-1).tolist(),
        "clearance_cm": {
            "min": float(clearance.min()),
            "median": float(np.median(clearance)),
            "max": float(clearance.max()),
        },
        "bounds_m": [draped.min(axis=0).tolist(), draped.max(axis=0).tolist()],
        "gpu": os.environ.get("MODAL_GPU", ""),
    }


@dev.local_entrypoint()
def main(
    body: str = "tmp/avatar-e2e/body-result.json",
    out: str = "tmp/avatar-e2e/sew-drape-result.json",
    size: str = "M",
    record_every: int = 2,
    repeat: int = 1,
    substeps: int = 4,
    sew_frames: int = 20,
    graph: bool = True,
) -> None:
    import numpy as np

    from body.topology import MHR_TOPOLOGY_VERSION
    from drape.collider import downsample_to_lod3

    with open(body, "r", encoding="utf-8") as handle:
        body_result = json.load(handle)
    if body_result.get("topology_version") != MHR_TOPOLOGY_VERSION:
        raise SystemExit(f"Body is not {MHR_TOPOLOGY_VERSION}.")
    lod1 = np.asarray(body_result["vertex_positions"], dtype=np.float64).reshape(-1, 3) / 100.0
    faces = np.load(os.path.join(os.path.dirname(os.path.abspath(__file__)), "body", "mhr_lod1_faces.npy"))
    lod3, lod3_faces = downsample_to_lod3(lod1.astype(np.float32), faces.astype(np.int32).reshape(-1))

    started = time.perf_counter()
    result = sew_and_drape.remote(
        CREWNECK_TEXT,
        json.dumps(CREWNECK_CHART),
        "tee",
        size,
        lod3.reshape(-1).tolist(),
        lod3_faces.reshape(-1).tolist(),
        CREWNECK_MECHANICAL,
        record_every,
        repeat,
        {"substeps": substeps, "sew_frames": sew_frames, "use_graph": graph},
    )
    result["wall_ms"] = round((time.perf_counter() - started) * 1000.0, 1)
    result["collider_positions"] = lod3.reshape(-1).tolist()
    result["collider_indices"] = lod3_faces.reshape(-1).tolist()
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(result, handle)
    summary = {key: result.get(key) for key in (
        "status", "reason", "size", "pattern_girths", "arrange", "frames_run", "converged",
        "final_displacement_m", "drape_timings_ms", "cold_drape_timings_ms", "solver", "shape_flags", "soft_contact_max", "timings_ms", "clearance_cm", "bounds_m", "wall_ms",
    )}
    print(json.dumps(summary, indent=2))
