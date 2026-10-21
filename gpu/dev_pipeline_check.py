"""Dev-only: the production pipeline's start-up and warm path, timed on one fresh container.

Ephemeral (`modal run`, never deployed); production is untouched. From the repo root:

    python -m modal run gpu/dev_pipeline_check.py --garment tmp/tryon/crewneck-M.garment.json \
        --mechanical tmp/tryon/crewneck-mech.json

Runs `AshriumPipeline.setup()` exactly as `@enter` does, then a body fit the
moment set-up returns (a shopper arriving during the warm-ups: the worst case),
a second body fit once the warm-ups are done, and two drapes of the same body
(the second must reuse the cached collider). Bodies come from the bundled
headless stock photos (gpu/body/warmup/), never a shopper's.
"""

from __future__ import annotations

import json
import os
import sys
import time

import modal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from modal_app import GARMENTCODE_ROOT, WEIGHTS_MOUNT, hf_secret, image, weights  # noqa: E402

dev = modal.App("ashrium-dev-pipeline-check")


@dev.function(
    image=image,
    gpu=["A100-80GB", "A100-40GB", "L40S"],
    timeout=900,
    volumes={WEIGHTS_MOUNT: weights},
    secrets=[hf_secret],
)
def check(garment_json: str, mechanical: dict) -> dict:
    from pathlib import Path

    import torch

    os.environ["ASHRIUM_WEIGHTS_ROOT"] = WEIGHTS_MOUNT
    os.environ["GARMENTCODE_ROOT"] = GARMENTCODE_ROOT
    os.environ.setdefault("ASHRIUM_WARP_CACHE", f"{WEIGHTS_MOUNT}/warp-cache")
    from pipeline import AshriumPipeline

    report: dict = {"gpu": torch.cuda.get_device_name(0)}
    started = time.perf_counter()
    pipeline = AshriumPipeline()
    pipeline.setup()
    report["setup_s"] = round(time.perf_counter() - started, 1)

    warmup = Path(__file__).resolve().parent / "body" / "warmup"

    def body(label: str) -> dict:
        t0 = time.perf_counter()
        result = pipeline.predict_body(warmup / "front.webp", warmup / "side.webp", 180.0, "male", 0.0)
        report[f"{label}_s"] = round(time.perf_counter() - t0, 1)
        report[f"{label}_stages_ms"] = {
            key: round(value)
            for key, value in (result.get("fit_diagnostics", {}).get("stage_timings_ms") or {}).items()
            if key != "setup"
        }
        report[f"{label}_girths"] = {k: round(v, 1) for k, v in result["derived_measurements"].items() if k.endswith("_cm")}
        return result

    body("body_during_warmup")
    time.sleep(25)
    fitted = body("body_warm")

    arguments = {
        "body_positions": json.dumps(fitted["vertex_positions"]),
        "garment_mesh": garment_json,
        "body_girths": json.dumps(fitted["derived_measurements"]),
        "tensile_stiffness": float(mechanical["tensile_stiffness"]),
        "bending_rigidity": float(mechanical["bending_rigidity"]),
        "shear_stiffness": float(mechanical["shear_stiffness"]),
        "area_density": float(mechanical["area_density"]),
    }
    for label in ("drape_first", "drape_again"):
        t0 = time.perf_counter()
        out = pipeline.predict_drape(**arguments)
        report[f"{label}_s"] = round(time.perf_counter() - t0, 1)
        report[f"{label}_status"] = out.get("status")
        report[f"{label}_timings_ms"] = out.get("timings_ms")
    report["total_s"] = round(time.perf_counter() - started, 1)
    return report


@dev.local_entrypoint()
def main(garment: str = "tmp/tryon/crewneck-M.garment.json", mechanical: str = "tmp/tryon/crewneck-mech.json") -> None:
    with open(garment, "r", encoding="utf-8") as handle:
        garment_json = handle.read()
    with open(mechanical, "r", encoding="utf-8") as handle:
        mech = json.load(handle)
    print(json.dumps(check.remote(garment_json, mech), indent=1))
