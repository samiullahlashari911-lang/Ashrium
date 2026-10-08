"""Re-instantiate a GarmentCode 2D pattern per published size. Never Laplacian / 3D scale."""

from __future__ import annotations

import copy
import json
import sys
from typing import Any

import yaml

from pattern.paths import body_yaml_path, design_yaml_path, garmentcode_root
from pattern.rest_length import (
    collect_body_panels,
    sample_quarter_widths_m,
    to_rest_length_mesh,
)
from pattern.style import parse_style

CHART_ABS_TOL_CM = 8.0
CHART_REL_TOL = 0.22
LENGTH_REL_TOL = 0.28


def _ensure_garmentcode_path() -> None:
    root = str(garmentcode_root())
    if root not in sys.path:
        sys.path.insert(0, root)


def _load_yaml_design() -> dict[str, Any]:
    with open(design_yaml_path(), "r", encoding="utf-8") as handle:
        payload = yaml.safe_load(handle)
    if not isinstance(payload, dict) or not isinstance(payload.get("design"), dict):
        raise RuntimeError("GarmentCode t-shirt.yaml is missing a design mapping.")
    return payload["design"]


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _apply_style(design: dict[str, Any], style: dict[str, Any]) -> None:
    design["meta"]["upper"]["v"] = style["upper"]
    design["meta"]["bottom"]["v"] = style["bottom"]
    design["meta"]["wb"]["v"] = None
    design["collar"]["component"]["style"]["v"] = None
    design["shirt"]["strapless"]["v"] = False
    design["shirt"]["width"]["v"] = float(style["shirt_width"])
    design["shirt"]["flare"]["v"] = 1.0
    design["sleeve"]["sleeveless"]["v"] = bool(style["sleeveless"])
    design["sleeve"]["length"]["v"] = float(style["sleeve_length"])
    design["left"]["enable_asym"]["v"] = False
    design["pants"]["cuff"]["type"]["v"] = None
    design["pants"]["flare"]["v"] = 1.0
    design["pants"]["width"]["v"] = 1.05


def _scale_body(body: Any, measurements: dict[str, float]) -> None:
    chest = float(measurements["chestCm"])
    waist = float(measurements["waistCm"])
    hip = float(measurements["hipCm"])
    template_bust = float(body["bust"])
    template_waist = float(body["waist"])
    template_hips = float(body["hips"])
    bust_scale = chest / max(template_bust, 1.0)
    waist_scale = waist / max(template_waist, 1.0)
    hip_scale = hip / max(template_hips, 1.0)

    body["bust"] = chest
    body["underbust"] = float(body["underbust"]) * bust_scale
    body["back_width"] = float(body["back_width"]) * bust_scale
    body["waist"] = waist
    body["waist_back_width"] = float(body["waist_back_width"]) * waist_scale
    body["hips"] = hip
    body["hip_back_width"] = float(body["hip_back_width"]) * hip_scale
    body["leg_circ"] = float(body["leg_circ"]) * hip_scale


def _apply_garment_length(body: Any, design: dict[str, Any], category: str, length_cm: float) -> None:
    if category == "pant":
        leg = max(float(body["_leg_length"]), 1.0)
        design["pants"]["length"]["v"] = _clamp(length_cm / leg, 0.2, 0.9)
        design["pants"]["rise"]["v"] = 1.0
        return
    waist_line = max(float(body["waist_line"]), 1.0)
    design["shirt"]["length"]["v"] = _clamp(length_cm / waist_line, 0.5, 3.5)


def _chart_ok(chart: float, pattern: float) -> bool:
    if chart <= 0 or pattern <= 0:
        return False
    delta = abs(pattern - chart)
    return delta <= max(CHART_ABS_TOL_CM, CHART_REL_TOL * chart)


def _cross_check(
    category: str,
    measurements: dict[str, Any],
    pattern_girths: dict[str, float],
    elastic_waist: bool = False,
) -> str | None:
    """Compare the instantiated pattern with the girths the chart published (never inferred ones).

    An elastic or drawstring waist is charted relaxed; its sewn waist is wider,
    so only a pattern waist narrower than the chart is a mismatch.
    """
    published = measurements.get("published", {*GIRTH_KEYS, "lengthCm"})
    if not _chart_ok(measurements["lengthCm"], pattern_girths["lengthCm"]):
        rel = abs(pattern_girths["lengthCm"] - measurements["lengthCm"]) / max(
            measurements["lengthCm"], 1.0
        )
        if rel > LENGTH_REL_TOL:
            return "chart_mismatch"
    checked = ("waistCm", "hipCm") if category == "pant" else ("chestCm", "waistCm")
    for key in checked:
        if key not in published:
            continue
        if key == "waistCm" and elastic_waist:
            if pattern_girths[key] < measurements[key] - CHART_ABS_TOL_CM:
                return "chart_mismatch"
            continue
        if not _chart_ok(measurements[key], pattern_girths[key]):
            return "chart_mismatch"
    return None


GIRTH_KEYS = ("chestCm", "waistCm", "hipCm")


def _parse_size_chart(raw: str, category: str) -> list[dict[str, Any]]:
    """Published sizes. Tops/dresses need chest + length; pants need waist or hip + length.

    Real charts publish only what matters for the garment (a tee has no hip), so
    other girths may be 0. `published` records what the chart actually stated.
    """
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"size_chart is not valid JSON: {error}") from error
    if not isinstance(payload, list) or len(payload) == 0:
        raise RuntimeError("size_chart must be a non-empty JSON array.")
    sizes: list[dict[str, Any]] = []
    for entry in payload:
        if not isinstance(entry, dict):
            raise RuntimeError("size_chart entries must be objects.")
        size_code = str(entry.get("sizeCode", "")).strip()
        measurements = {
            key: max(0.0, float(entry.get(key, 0) or 0)) for key in (*GIRTH_KEYS, "lengthCm")
        }
        published = {key for key, value in measurements.items() if value > 0}
        if category == "pant":
            girth_ok = "waistCm" in published or "hipCm" in published
            need = "waist or hip"
        else:
            girth_ok = "chestCm" in published
            need = "chest"
        if not size_code or not girth_ok or "lengthCm" not in published:
            raise RuntimeError(f"Each size needs sizeCode, {need}, and length in cm.")
        sizes.append({"sizeCode": size_code, **measurements, "published": published})
    return sizes


def _fill_unpublished_girths(size: dict[str, Any], body: Any) -> None:
    """Infer girths the chart did not publish from the template body's proportions.

    Pattern geometry only: inferred values shape GarmentCode's body proxy, are
    never cross-checked as if published, and never reach the catalog or the
    size verdict (that is girths + the published chart).
    """
    template = {"chestCm": float(body["bust"]), "waistCm": float(body["waist"]), "hipCm": float(body["hips"])}
    anchors = [key for key in GIRTH_KEYS if key in size["published"]]
    for key in GIRTH_KEYS:
        if key in size["published"]:
            continue
        ratios = [size[anchor] / max(template[anchor], 1.0) for anchor in anchors]
        size[key] = template[key] * (sum(ratios) / len(ratios))


def instantiate_patterns(
    category: str,
    product_text: str,
    size_chart_json: str,
) -> dict[str, Any]:
    _ensure_garmentcode_path()
    from assets.bodies.body_params import BodyParameters
    from assets.garment_programs.meta_garment import MetaGarment

    style = parse_style(category, product_text)
    if style["unsupported_reason"]:
        return {
            "task": "pattern",
            "status": "unsupported",
            "unsupported_reason": style["unsupported_reason"],
            "meshes": [],
        }

    sizes = _parse_size_chart(size_chart_json, category)
    base_design = _load_yaml_design()
    meshes: list[dict[str, Any]] = []

    for size in sizes:
        body = BodyParameters(str(body_yaml_path()))
        _fill_unpublished_girths(size, body)
        _scale_body(body, size)
        design = copy.deepcopy(base_design)
        _apply_style(design, style)
        _apply_garment_length(body, design, category, float(size["lengthCm"]))

        try:
            garment = MetaGarment(f"ashrium_{size['sizeCode']}", body, design)
            garment.assert_non_empty()
        except Exception as error:
            return {
                "task": "pattern",
                "status": "instantiate_failed",
                "unsupported_reason": str(error),
                "meshes": [],
            }

        if garment.is_self_intersecting():
            return {
                "task": "pattern",
                "status": "self_intersecting",
                "unsupported_reason": f"self-intersecting 2D pattern for size {size['sizeCode']}",
                "meshes": [],
            }

        panels = collect_body_panels(garment)
        if len(panels) == 0:
            return {
                "task": "pattern",
                "status": "instantiate_failed",
                "unsupported_reason": "GarmentCode produced no body panels.",
                "meshes": [],
            }

        try:
            quarter_widths, pattern_girths = sample_quarter_widths_m(panels, category)
        except Exception as error:
            return {
                "task": "pattern",
                "status": "instantiate_failed",
                "unsupported_reason": str(error),
                "meshes": [],
            }

        mismatch = _cross_check(category, size, pattern_girths, bool(style.get("elastic_waist")))
        if mismatch:
            return {
                "task": "pattern",
                "status": mismatch,
                "unsupported_reason": (
                    f"Instantiated girths {pattern_girths} disagree with chart {size['sizeCode']}"
                ),
                "meshes": [],
            }

        mesh = to_rest_length_mesh(category, str(size["sizeCode"]), size, quarter_widths)
        mesh["pattern_girths"] = pattern_girths
        # Girths not listed here were inferred for pattern geometry only.
        mesh["published_measurements"] = sorted(size["published"])
        meshes.append(mesh)

    return {
        "task": "pattern",
        "status": "ok",
        "unsupported_reason": None,
        "meshes": meshes,
    }
