"""Dev-only: sew a real GarmentCode garment in every chart size and drape each on a test body.

Ephemeral (`modal run`, never deployed); production is untouched. From the repo root:

    python -m modal run gpu/dev_sew_drape.py --body tmp/avatar-e2e/body-result.json \
        --out tmp/avatar-e2e/sew-drape-result.json

Per size it records the pattern (calibrated to the chart), the sewn mesh at
every stage, the simulation frames, the border check against the drawn
(LOD 1) body, a per-vertex fit map, and timings, for the playback viewer.
"""

from __future__ import annotations

import json
import os
import sys
import time

import modal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from modal_app import WEIGHTS_MOUNT, image, weights  # noqa: E402  (same image as production)

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


def _ms(started: float) -> float:
    return round((time.perf_counter() - started) * 1000.0, 1)


@dev.function(
    image=image,
    gpu=["A100-80GB", "A100-40GB", "L40S"],
    timeout=1200,
    volumes={WEIGHTS_MOUNT: weights},
)
def sew_and_drape(
    product_text: str,
    size_chart: str,
    category: str,
    body_positions: list[float],
    body_faces: list[int],
    mechanical: dict[str, float],
    record_every: int,
    solver: dict | None = None,
) -> dict:
    import numpy as np

    if "/opt/ashrium" not in sys.path:
        sys.path.insert(0, "/opt/ashrium")
    os.environ.setdefault("ASHRIUM_WARP_CACHE", f"{WEIGHTS_MOUNT}/warp-cache")
    from drape.arrange import arrange_on_body
    from drape.border import enforce_border, inflate_collider, signed_distance_to_mesh
    from drape.collider import downsample_to_lod3
    from drape.newton_style3d import drape_style3d
    from pattern.instantiate import instantiate_patterns

    started = time.perf_counter()
    pattern = instantiate_patterns(category, product_text, size_chart, sew=True)
    pattern_ms = _ms(started)
    if pattern["status"] != "ok":
        return {"status": pattern["status"], "reason": pattern["unsupported_reason"]}

    body = np.asarray(body_positions, dtype=np.float64).reshape(-1, 3)
    faces = np.asarray(body_faces, dtype=np.int64).reshape(-1, 3)
    step = time.perf_counter()
    lod3, lod3_faces = downsample_to_lod3(body.astype(np.float32), faces.astype(np.int32).reshape(-1))
    lod3 = lod3.astype(np.float64)
    lod3_faces = lod3_faces.reshape(-1, 3).astype(np.int64)
    collider, inflate_m = inflate_collider(lod3, lod3_faces, body, faces)
    collider_ms = _ms(step)

    sizes = []
    chart = {entry["sizeCode"]: entry for entry in json.loads(size_chart)}
    for rest in pattern["meshes"]:
        code = rest["sizeCode"]
        garment = rest.pop("garment_mesh")
        timings: dict[str, float] = {}
        step = time.perf_counter()
        arranged = arrange_on_body(garment, body, faces)
        timings["arrange_ms"] = _ms(step)
        entry = {
            "size": code,
            "chart": chart[code],
            "pattern_girths": rest["pattern_girths"],
            "calibration_iterations": rest.get("calibration_iterations"),
            "garment": garment,
            "placed_positions": arranged["placed_positions"].astype(np.float32).reshape(-1).tolist(),
            "welded_id": arranged["welded_id"].tolist(),
            "welded_triangles": arranged["welded_triangles"].reshape(-1).tolist(),
            "sewn_positions": arranged["welded_positions"].astype(np.float32).reshape(-1).tolist(),
            "arrange": arranged["diagnostics"],
        }
        try:
            drape = drape_style3d(
                welded_positions=arranged["welded_positions"],
                welded_triangles=arranged["welded_triangles"],
                panel_uv=arranged["rest_uv"],
                panel_triangles=arranged["panel_triangles"],
                collider_positions=collider.astype(np.float32),
                collider_indices=lod3_faces.astype(np.int32),
                mechanical=mechanical,
                record_every=record_every,
                **(solver or {}),
            )
        except Exception as error:  # dev harness: keep the sewn mesh for diagnosis
            import traceback

            sizes.append({**entry, "status": "drape_failed", "reason": str(error),
                          "traceback": traceback.format_exc()[-3000:], "timings_ms": timings})
            continue
        timings.update({f"drape_{key}": value for key, value in drape["timings_ms"].items()})

        step = time.perf_counter()
        draped = drape["positions"].astype(np.float64)
        before, _ = signed_distance_to_mesh(draped, body, faces)
        bordered, moved = enforce_border(draped, body, faces)
        after, _ = signed_distance_to_mesh(bordered, body, faces)
        timings["border_ms"] = _ms(step)
        timings["per_shopper_ms"] = round(
            timings["arrange_ms"] + drape["timings_ms"]["total_ms"] + timings["border_ms"], 1
        )
        sizes.append({
            **entry,
            "status": "ok",
            "frames": drape["frames"],
            "frame_phase": drape["frame_phase"],
            "frames_run": drape["frames_run"],
            "converged": drape["converged"],
            "solver": drape["solver"],
            "stiffness": drape["stiffness"],
            "draped_positions": bordered.astype(np.float32).reshape(-1).tolist(),
            # Fit map: exact distance from each garment vertex to the drawn body (cm).
            "fit_gap_cm": np.round(after * 100.0, 2).astype(np.float32).tolist(),
            "border": {
                "inside_before": int((before < 0).sum()),
                "deepest_before_mm": round(float(before.min()) * 1000.0, 1),
                "moved": moved,
                "inside_after": int((after < 0).sum()),
                "closest_after_mm": round(float(after.min()) * 1000.0, 2),
            },
            "timings_ms": timings,
        })

    weights.commit()  # keep the compiled-kernel cache for the next container
    return {
        "status": "ok",
        "sizes": sizes,
        "pattern_and_sew_ms": pattern_ms,
        "collider_ms": collider_ms,
        "collider_inflate_max_mm": round(inflate_m * 1000.0, 1),
        "total_ms": _ms(started),
        "collider_positions": collider.astype(np.float32).reshape(-1).tolist(),
        "collider_indices": lod3_faces.reshape(-1).tolist(),
    }


@dev.local_entrypoint()
def main(
    body: str = "tmp/avatar-e2e/body-result.json",
    out: str = "tmp/avatar-e2e/sew-drape-result.json",
    record_every: int = 2,
    substeps: int = 4,
    sew_frames: int = 20,
    graph: bool = True,
) -> None:
    import numpy as np

    from body.topology import MHR_TOPOLOGY_VERSION

    with open(body, "r", encoding="utf-8") as handle:
        body_result = json.load(handle)
    if body_result.get("topology_version") != MHR_TOPOLOGY_VERSION:
        raise SystemExit(f"Body is not {MHR_TOPOLOGY_VERSION}.")
    lod1 = np.asarray(body_result["vertex_positions"], dtype=np.float64).reshape(-1, 3) / 100.0
    faces = np.load(os.path.join(os.path.dirname(os.path.abspath(__file__)), "body", "mhr_lod1_faces.npy"))

    started = time.perf_counter()
    result = sew_and_drape.remote(
        CREWNECK_TEXT,
        json.dumps(CREWNECK_CHART),
        "tee",
        lod1.reshape(-1).tolist(),
        faces.astype(np.int64).reshape(-1).tolist(),
        CREWNECK_MECHANICAL,
        record_every,
        {"substeps": substeps, "sew_frames": sew_frames, "use_graph": graph},
    )
    result["wall_ms"] = round((time.perf_counter() - started) * 1000.0, 1)
    result["body_chest_cm"] = body_result["derived_measurements"]["chest_cm"]
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(result, handle)
    print(json.dumps({key: result.get(key) for key in (
        "status", "reason", "pattern_and_sew_ms", "collider_ms", "collider_inflate_max_mm", "total_ms", "wall_ms",
    )}, indent=2))
    for size in result.get("sizes", []):
        print(json.dumps({key: size.get(key) for key in (
            "size", "status", "reason", "chart", "pattern_girths", "calibration_iterations", "frames_run",
            "converged", "border", "timings_ms",
        )}))
