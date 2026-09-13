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
    measurements: dict[str, float],
    pattern_girths: dict[str, float],
) -> str | None:
    if not _chart_ok(measurements["lengthCm"], pattern_girths["lengthCm"]):
        rel = abs(pattern_girths["lengthCm"] - measurements["lengthCm"]) / max(
            measurements["lengthCm"], 1.0
        )
        if rel > LENGTH_REL_TOL:
            return "chart_mismatch"
    if category == "pant":
        if not _chart_ok(measurements["waistCm"], pattern_girths["waistCm"]):
            return "chart_mismatch"
        if not _chart_ok(measurements["hipCm"], pattern_girths["hipCm"]):
            return "chart_mismatch"
        return None
    if not _chart_ok(measurements["chestCm"], pattern_girths["chestCm"]):
        return "chart_mismatch"
    if not _chart_ok(measurements["waistCm"], pattern_girths["waistCm"]):
        return "chart_mismatch"
    return None


def _parse_size_chart(raw: str) -> list[dict[str, Any]]:
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
            "chestCm": float(entry.get("chestCm", 0)),
            "waistCm": float(entry.get("waistCm", 0)),
            "hipCm": float(entry.get("hipCm", 0)),
            "lengthCm": float(entry.get("lengthCm", 0)),
        }
        if not size_code or any(value <= 0 for value in measurements.values()):
            raise RuntimeError("Each size needs sizeCode and positive chest/waist/hip/length cm.")
        sizes.append({"sizeCode": size_code, **measurements})
    return sizes


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

    sizes = _parse_size_chart(size_chart_json)
    base_design = _load_yaml_design()
    meshes: list[dict[str, Any]] = []

    for size in sizes:
        body = BodyParameters(str(body_yaml_path()))
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

        mismatch = _cross_check(category, size, pattern_girths)
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
        meshes.append(mesh)

    return {
        "task": "pattern",
        "status": "ok",
        "unsupported_reason": None,
        "meshes": meshes,
    }
