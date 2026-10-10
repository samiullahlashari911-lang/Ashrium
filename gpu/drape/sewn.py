"""Drape one size of a sewn GarmentCode garment on the shopper's MHR body, with checks.

One entry point for production `task=drape`, the dev harness and the drape
grid, so what the grid proves is what shoppers get. Steps: too-small check
(the size cannot close around this body) → placement (`arrange.py`) →
Newton Style3D on the inflated LOD 3 collider → hard border on the exact
LOD 1 body → quality checks. Metres, Y-up. The size verdict is never
decided here: that is girths + the published chart.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from drape.arrange import arrange_on_body, body_normals
from drape.border import enforce_border, inflate_collider, nearest_vertices, signed_distance_to_mesh
from drape.collider import downsample_to_lod3
from drape.newton_style3d import drape_style3d

# The drape grid (12 bodies x 4 garments, 228 drapes): every size at least 2%
# larger than the body at its closing girth draped cleanly (89 of 89); closer
# fits overstretched or sank into the body (8 of 11 under -4%). The cloth model
# cannot show a body-hugging fit, so those sizes are "too tight to show".
MIN_EASE = 0.02
# Elastic / drawstring waist: the top band of each panel is gathered to the
# chart's relaxed waist, so it grips the body like the real waistband.
WAIST_BAND_M = 0.04

# Quality limits (the drape grid's pass/fail). Edge ratio = drawn / pattern length.
# Healthy drapes: p99 1.10-1.27, single seam edges up to ~2.2. Explosions: p99 > 1.4.
STRETCH_P99_FAIL = 1.35
STRETCH_MAX_FAIL = 3.0
FLOAT_MAX_FAIL_M = 0.25
SANK_WARN_MM = -10.0
WAIST_SLID_WARN_M = 0.06


def too_small(
    category: str,
    pattern_girths: dict[str, float],
    body_girths: dict[str, float],
    elastic_waist: bool = False,
) -> str | None:
    """Why this size is too tight to drape on the body, or None.

    Tops close at the chest, bottoms at the seat (and at a waist that has no
    elastic); each needs MIN_EASE over the body there.
    """
    keys = [("hipCm", "hip_cm")] if category == "pant" else [("chestCm", "chest_cm")]
    if category == "pant" and not elastic_waist:
        keys.append(("waistCm", "waist_cm"))
    for pattern_key, body_key in keys:
        garment = float(pattern_girths.get(pattern_key) or 0.0)
        body = float(body_girths.get(body_key) or 0.0)
        if garment > 0 and body > 0 and garment < body * (1.0 + MIN_EASE):
            label = pattern_key.removesuffix("Cm")
            return f"{label} {garment:.0f} cm on a {body:.0f} cm body"
    return None


def gather_elastic_waist(rest_uv: np.ndarray, panel_of_vertex: np.ndarray, sewn_waist_cm: float, relaxed_waist_cm: float) -> float:
    """Gather the top band of every panel to the relaxed waist (rest shape, in place).

    GarmentCode sews a drawstring waist at its stretched width; without the
    elastic, joggers slid off a slim body. The band's rest width is scaled by
    relaxed/sewn about each panel's middle (full within WAIST_BAND_M of the
    top, easing back to the pattern over the next WAIST_BAND_M), so the band
    stretches over the shopper's waist and holds. Panel y is up (GarmentCode).
    Returns the gather factor.
    """
    factor = float(np.clip(relaxed_waist_cm / max(sewn_waist_cm, 1.0), 0.6, 1.0))
    if factor >= 1.0:
        return 1.0
    for panel in np.unique(panel_of_vertex):
        mask = panel_of_vertex == panel
        uv = rest_uv[mask]
        depth = float(uv[:, 1].max()) - uv[:, 1]
        weight = np.clip((2.0 * WAIST_BAND_M - depth) / WAIST_BAND_M, 0.0, 1.0)
        middle = 0.5 * (float(uv[:, 0].min()) + float(uv[:, 0].max()))
        uv[:, 0] = middle + (uv[:, 0] - middle) * (1.0 - (1.0 - factor) * weight)
        rest_uv[mask] = uv
    return factor


def body_collider(body_m: np.ndarray, body_faces: np.ndarray) -> tuple[np.ndarray, np.ndarray, float]:
    """Inflated LOD 3 collider (positions, faces) for the solver; built once per shopper."""
    lod3, lod3_faces = downsample_to_lod3(body_m.astype(np.float32), body_faces.astype(np.int32).reshape(-1))
    lod3_faces = lod3_faces.reshape(-1, 3).astype(np.int64)
    collider, inflate_m = inflate_collider(lod3.astype(np.float64), lod3_faces, body_m, body_faces)
    return collider, lod3_faces, inflate_m


def _edge_ratios(positions: np.ndarray, rest_uv: np.ndarray, welded: np.ndarray, panel: np.ndarray) -> np.ndarray:
    ratios = []
    for a, b in ((0, 1), (1, 2), (2, 0)):
        drawn = np.linalg.norm(positions[welded[:, a]] - positions[welded[:, b]], axis=1)
        rest = np.linalg.norm(rest_uv[panel[:, a]] - rest_uv[panel[:, b]], axis=1)
        ratios.append(drawn / np.maximum(rest, 1e-6))
    return np.concatenate(ratios)


def drape_quality(
    category: str,
    draped: np.ndarray,
    arranged: dict[str, Any],
    gap_m: np.ndarray,
    border: dict[str, Any],
    converged: bool,
    waist_y: float | None,
) -> tuple[dict[str, Any], list[dict[str, str]]]:
    """Measurements of the settled garment and the problems they show."""
    ratios = _edge_ratios(draped, arranged["rest_uv"], arranged["welded_triangles"], arranged["panel_triangles"])
    metrics: dict[str, Any] = {
        "stretch_p50": round(float(np.percentile(ratios, 50)), 3),
        "stretch_p99": round(float(np.percentile(ratios, 99)), 3),
        "stretch_max": round(float(ratios.max()), 3),
        "compress_p1": round(float(np.percentile(ratios, 1)), 3),
        "gap_p50_cm": round(float(np.percentile(gap_m, 50)) * 100.0, 2),
        "gap_p99_cm": round(float(np.percentile(gap_m, 99)) * 100.0, 2),
        "gap_max_cm": round(float(gap_m.max()) * 100.0, 2),
    }
    problems: list[dict[str, str]] = []

    def problem(level: str, code: str, detail: str) -> None:
        problems.append({"level": level, "code": code, "detail": detail})

    if border["inside_after"] > 0:
        problem("fail", "inside_body", f"{border['inside_after']} cloth points inside the body")
    if metrics["stretch_max"] > STRETCH_MAX_FAIL:
        problem("fail", "torn", f"an edge stretched to {metrics['stretch_max']}x its pattern length")
    if metrics["stretch_p99"] > STRETCH_P99_FAIL:
        problem("fail", "overstretched", f"1% of edges stretched past {metrics['stretch_p99']}x")
    if float(gap_m.max()) > FLOAT_MAX_FAIL_M:
        problem("fail", "floating", f"cloth {metrics['gap_max_cm']} cm off the body")
    if border["deepest_before_mm"] < SANK_WARN_MM:
        problem("warn", "sank", f"solver left cloth {border['deepest_before_mm']} mm inside before the border")
    if not converged:
        problem("warn", "not_settled", "cloth still moving at the frame cap")
    if waist_y is not None:
        top = float(draped[:, 1].max())
        metrics["waist_drop_cm"] = round((waist_y - top) * 100.0, 1)
        if waist_y - top > WAIST_SLID_WARN_M:
            problem("warn", "slid_down", f"waistband {metrics['waist_drop_cm']} cm below the waist")
    return metrics, problems


def drape_sewn_size(
    garment_mesh: dict[str, Any],
    category: str,
    body_m: np.ndarray,
    body_faces: np.ndarray,
    collider: tuple[np.ndarray, np.ndarray],
    mechanical: dict[str, float],
    waist_y: float | None = None,
    record_every: int = 0,
    solver: dict[str, Any] | None = None,
    arrange_options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Arrange, drape and border one size. `waist_y` (m) is required for bottoms."""
    if category == "pant" and waist_y is None:
        raise RuntimeError("Bottoms drape from the shopper's waist: waist_y is required.")
    arranged = arrange_on_body(
        garment_mesh, body_m, body_faces, waist_y if category == "pant" else None, **(arrange_options or {})
    )
    # The solver's rest shape: the pattern, with an elastic band gathered. Quality
    # is measured against the pattern itself (a stretched waistband is the point).
    gather = 1.0
    solver_uv = arranged["rest_uv"]
    relaxed = garment_mesh.get("chart_waist_cm")
    sewn_waist = (garment_mesh.get("pattern_girths") or {}).get("waistCm")
    if category == "pant" and garment_mesh.get("elastic_waist") and relaxed and sewn_waist:
        solver_uv = arranged["rest_uv"].copy()
        gather = gather_elastic_waist(solver_uv, arranged["panel_of_vertex"], float(sewn_waist), float(relaxed))
    collider_positions, collider_faces = collider
    drape = drape_style3d(
        welded_positions=arranged["welded_positions"],
        welded_triangles=arranged["welded_triangles"],
        panel_uv=solver_uv,
        panel_triangles=arranged["panel_triangles"],
        collider_positions=collider_positions.astype(np.float32),
        collider_indices=collider_faces.astype(np.int32),
        mechanical=mechanical,
        record_every=record_every,
        **(solver or {}),
    )
    draped = drape["positions"].astype(np.float64)
    before, _ = signed_distance_to_mesh(draped, body_m, body_faces)
    bordered, moved = enforce_border(draped, body_m, body_faces)
    after, _ = signed_distance_to_mesh(bordered, body_m, body_faces)
    border = {
        "inside_before": int((before < 0).sum()),
        "deepest_before_mm": round(float(before.min()) * 1000.0, 1),
        "moved": moved,
        "inside_after": int((after < 0).sum()),
        "closest_after_mm": round(float(after.min()) * 1000.0, 2),
    }
    metrics, problems = drape_quality(
        category, bordered, arranged, after, border, bool(drape["converged"]), waist_y if category == "pant" else None
    )
    if category != "pant":
        metrics["sleeve_sag"] = _sleeve_sag(garment_mesh, arranged, bordered, after, body_m, body_faces)
    else:
        metrics["waist_gather"] = round(gather, 3)
    return {
        "positions": bordered,
        "triangles": arranged["welded_triangles"],
        "welded_id": arranged["welded_id"],
        "arranged": arranged,
        "drape": drape,
        "border": border,
        "fit_gap_m": after,
        "metrics": metrics,
        "problems": problems,
        "passed": not any(p["level"] == "fail" for p in problems),
    }


def _sleeve_sag(
    garment: dict[str, Any],
    arranged: dict[str, Any],
    positions: np.ndarray,
    gap_m: np.ndarray,
    body_m: np.ndarray,
    body_faces: np.ndarray,
) -> dict[str, float | None]:
    """Gap on top of vs under the arm: hanging cloth is close on top, loose below."""
    welded_panel = np.zeros(int(arranged["welded_id"].max()) + 1, dtype=np.int64)
    welded_panel[arranged["welded_id"]] = arranged["panel_of_vertex"]
    sleeve = np.isin(welded_panel, [i for i, name in enumerate(garment["panels"]) if "sleeve" in name])
    if not sleeve.any():
        return {"top_gap_cm": None, "under_gap_cm": None}
    _gap, surface = signed_distance_to_mesh(positions[sleeve], body_m, body_faces)
    up = body_normals(body_m, body_faces)[nearest_vertices(surface, body_m, 1)[:, 0]][:, 1]
    gaps = gap_m[sleeve] * 100.0
    return {
        "top_gap_cm": round(float(np.median(gaps[up > 0.4])), 2) if (up > 0.4).any() else None,
        "under_gap_cm": round(float(np.median(gaps[up < -0.4])), 2) if (up < -0.4).any() else None,
    }


def _round(values: np.ndarray, decimals: int = 5) -> list[float]:
    return np.round(np.asarray(values, dtype=np.float64), decimals).reshape(-1).tolist()


def sim_output(result: dict[str, Any], garment_mesh: dict[str, Any]) -> dict[str, Any]:
    """The app's drape payload (lib/ml/gpu.ts parseDrapeSimOutput) from a sewn drape.

    rest = the garment as placed around the body before the solver; delta =
    settled - rest; clearance = exact gap to the drawn body (cm); strain = how
    far each vertex's longest edge is stretched past its pattern length. `uv`
    is the 2D pattern position (texture space) of each welded vertex.
    """
    rest = result["arranged"]["welded_positions"]
    positions = result["positions"]
    welded_id = result["welded_id"]
    triangles = result["triangles"]
    ratios = _edge_ratios(
        positions, result["arranged"]["rest_uv"], triangles, result["arranged"]["panel_triangles"]
    ).reshape(3, -1)
    strain = np.zeros(rest.shape[0])
    for corner, ratio in zip(((0, 1), (1, 2), (2, 0)), ratios):
        for end in corner:
            np.maximum.at(strain, triangles[:, end], np.maximum(ratio - 1.0, 0.0))
    uv = np.zeros((rest.shape[0], 2))
    uv[welded_id] = result["arranged"]["texture_uv"]
    return {
        "status": "ok" if result["passed"] else "problem",
        "problems": result["problems"],
        "metrics": result["metrics"],
        "border": result["border"],
        "rest_positions": _round(rest),
        "delta": _round(positions - rest),
        "strain": _round(strain, 4),
        "clearance_cm": _round(result["fit_gap_m"] * 100.0, 2),
        "indices": triangles.astype(np.int64).reshape(-1).tolist(),
        "uv": _round(uv),
        "vertex_count": int(rest.shape[0]),
        "mean_strain": round(float(strain.mean()), 5),
        "frames": int(result["drape"]["frames_run"]),
        "converged": bool(result["drape"]["converged"]),
        "timings_ms": result["drape"]["timings_ms"],
    }
