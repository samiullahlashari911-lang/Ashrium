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
    runs: list[dict],
) -> dict:
    """`runs`: [{"label", "size", "solver": {...drape_style3d overrides}}], one drape each."""
    import numpy as np

    if "/opt/ashrium" not in sys.path:
        sys.path.insert(0, "/opt/ashrium")
    os.environ.setdefault("ASHRIUM_WARP_CACHE", f"{WEIGHTS_MOUNT}/warp-cache")
    from drape.arrange import arrange_on_body
    from drape.border import enforce_border, inflate_collider, nearest_vertices, signed_distance_to_mesh
    from drape.arrange import body_normals
    from drape.collider import downsample_to_lod3
    from drape.newton_style3d import drape_style3d
    from pattern.instantiate import instantiate_patterns

    started = time.perf_counter()
    chart = {entry["sizeCode"]: entry for entry in json.loads(size_chart)}
    patterns: dict[str, dict] = {}
    for run in runs:
        key = json.dumps(run.get("pattern", {}), sort_keys=True)
        if key in patterns:
            continue
        codes = sorted({r["size"] for r in runs if json.dumps(r.get("pattern", {}), sort_keys=True) == key})
        result = instantiate_patterns(
            category, product_text, json.dumps([chart[code] for code in codes]),
            sew=True, style_overrides=run.get("pattern") or None,
        )
        if result["status"] != "ok":
            return {"status": result["status"], "reason": result["unsupported_reason"]}
        patterns[key] = {rest["sizeCode"]: rest for rest in result["meshes"]}
    pattern_ms = _ms(started)

    body = np.asarray(body_positions, dtype=np.float64).reshape(-1, 3)
    faces = np.asarray(body_faces, dtype=np.int64).reshape(-1, 3)
    step = time.perf_counter()
    lod3, lod3_faces = downsample_to_lod3(body.astype(np.float32), faces.astype(np.int32).reshape(-1))
    lod3 = lod3.astype(np.float64)
    lod3_faces = lod3_faces.reshape(-1, 3).astype(np.int64)
    collider, inflate_m = inflate_collider(lod3, lod3_faces, body, faces)
    collider_ms = _ms(step)

    sizes = []
    normals = body_normals(body, faces)
    arranged_cache: dict[str, tuple[dict, float]] = {}
    for run in runs:
        code = run["size"]
        key = json.dumps(run.get("pattern", {}), sort_keys=True)
        rest = patterns[key][code]
        garment = rest["garment_mesh"]
        timings: dict[str, float] = {}
        if (key, code) not in arranged_cache:
            step = time.perf_counter()
            arranged_cache[(key, code)] = (arrange_on_body(garment, body, faces), _ms(step))
        arranged, timings["arrange_ms"] = arranged_cache[(key, code)]
        entry = {
            "label": run.get("label", code),
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
                **run.get("solver", {}),
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
        # Sleeve sag: gap below the arm vs on top of it (cloth hanging = small on top, large below).
        welded_panel = np.zeros(int(arranged["welded_id"].max()) + 1, dtype=np.int64)
        welded_panel[arranged["welded_id"]] = np.asarray(garment["panel_of_vertex"])
        sleeve = np.isin(welded_panel, [i for i, n in enumerate(garment["panels"]) if "sleeve" in n])
        _gap, surface = signed_distance_to_mesh(bordered[sleeve], body, faces)
        up = normals[nearest_vertices(surface, body, 1)[:, 0]][:, 1]
        gaps = after[sleeve] * 100.0
        sag = {
            "top_gap_cm": round(float(np.median(gaps[up > 0.4])), 2) if (up > 0.4).any() else None,
            "under_gap_cm": round(float(np.median(gaps[up < -0.4])), 2) if (up < -0.4).any() else None,
            "sleeve_mean_y_m": round(float(bordered[sleeve][:, 1].mean()), 4),
        }
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
            "sleeve_sag": sag,
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


@dev.function(image=image, cpu=4.0, memory=8192, timeout=900)
def sew_sweep(product_text: str, size_chart: str, category: str, variants: list[dict]) -> list[dict]:
    """Pattern + sewing only (no GPU): garment openings per style override."""
    if "/opt/ashrium" not in sys.path:
        sys.path.insert(0, "/opt/ashrium")
    from pattern.instantiate import instantiate_patterns
    from pattern.sew import garment_openings_cm

    out = []
    for variant in variants:
        result = instantiate_patterns(category, product_text, size_chart, sew=True, style_overrides=variant)
        if result["status"] != "ok":
            out.append({"variant": variant, "status": result["status"], "reason": result["unsupported_reason"]})
            continue
        for mesh in result["meshes"]:
            out.append({"variant": variant, "size": mesh["sizeCode"], **garment_openings_cm(mesh["garment_mesh"])})
    return out


@dev.local_entrypoint()
def main(
    body: str = "tmp/avatar-e2e/body-result.json",
    out: str = "tmp/avatar-e2e/sew-drape-result.json",
    record_every: int = 2,
    substeps: int = 4,
    sew_frames: int = 20,
    graph: bool = True,
    runs: str = "",
    sweep: str = "",
) -> None:
    """`runs`: JSON list for experiments; default drapes every chart size."""
    import numpy as np

    from body.topology import MHR_TOPOLOGY_VERSION

    with open(body, "r", encoding="utf-8") as handle:
        body_result = json.load(handle)
    if body_result.get("topology_version") != MHR_TOPOLOGY_VERSION:
        raise SystemExit(f"Body is not {MHR_TOPOLOGY_VERSION}.")
    lod1 = np.asarray(body_result["vertex_positions"], dtype=np.float64).reshape(-1, 3) / 100.0
    faces = np.load(os.path.join(os.path.dirname(os.path.abspath(__file__)), "body", "mhr_lod1_faces.npy"))

    if sweep:
        chart = [entry for entry in CREWNECK_CHART if entry["sizeCode"] == "M"]
        for row in sew_sweep.remote(CREWNECK_TEXT, json.dumps(chart), "tee", json.loads(sweep)):
            print(json.dumps(row))
        return

    started = time.perf_counter()
    result = sew_and_drape.remote(
        CREWNECK_TEXT,
        json.dumps(CREWNECK_CHART),
        "tee",
        lod1.reshape(-1).tolist(),
        faces.astype(np.int64).reshape(-1).tolist(),
        CREWNECK_MECHANICAL,
        record_every,
        json.loads(runs) if runs else [
            {"label": entry["sizeCode"], "size": entry["sizeCode"],
             "solver": {"substeps": substeps, "sew_frames": sew_frames, "use_graph": graph}}
            for entry in CREWNECK_CHART
        ],
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
            "label", "status", "reason", "frames_run", "converged", "border", "sleeve_sag", "timings_ms",
        )}))
