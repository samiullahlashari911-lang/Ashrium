"""Dev-only: drape the same bodies with several solver / arrangement variants in one container.

Ephemeral (`modal run`, never deployed); production is untouched. From the repo root:

    python -m modal run gpu/dev_drape_variants.py --jobs tmp/bodyfit/variant-jobs.json \
        --out tmp/bodyfit/variants.json

`--jobs` is JSON: {"bodies": {label: [body_json_path, garment_json_path]}, "mechanical": {...},
"variants": {name: {"solver": {...drape_style3d kwargs}, "arrange": {...arrange_on_body kwargs}}}}.
Reports status, problems and quality metrics per body and variant (no meshes).
"""

from __future__ import annotations

import json
import os
import sys
import time

import modal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from modal_app import GARMENTCODE_ROOT, WEIGHTS_MOUNT, hf_secret, image, weights  # noqa: E402

dev = modal.App("ashrium-dev-drape-variants")


@dev.function(
    image=image,
    gpu=["A100-80GB", "A100-40GB", "L40S"],
    timeout=1200,
    volumes={WEIGHTS_MOUNT: weights},
    secrets=[hf_secret],
)
def run(bodies: dict, garments: dict, mechanical: dict, variants: dict) -> dict:
    import numpy as np

    os.environ["ASHRIUM_WEIGHTS_ROOT"] = WEIGHTS_MOUNT
    os.environ["GARMENTCODE_ROOT"] = GARMENTCODE_ROOT
    os.environ.setdefault("ASHRIUM_WARP_CACHE", f"{WEIGHTS_MOUNT}/warp-cache")
    from body.photo_uv import mhr_lod1_faces
    from drape.sewn import drape_sewn_size
    from pipeline import AshriumPipeline

    pipeline = AshriumPipeline()
    pipeline.setup()
    faces = mhr_lod1_faces()
    report: dict = {}
    for label, (positions, garment_key) in bodies.items():
        body_cm = np.asarray(positions, dtype=np.float64).reshape(-1, 3)
        prep = pipeline.body_prep(body_cm)
        for name, variant in variants.items():
            started = time.perf_counter()
            try:
                result = drape_sewn_size(
                    garments[garment_key], "tee", body_cm / 100.0, faces, prep["collider"], mechanical,
                    solver=variant.get("solver"), arrange_options=variant.get("arrange"),
                )
                entry = {
                    "passed": result["passed"],
                    "problems": [f"{p['level']}:{p['code']}" for p in result["problems"]],
                    "stretch_max": result["metrics"].get("stretch_max"),
                    "stretch_p99": result["metrics"].get("stretch_p99"),
                    "gap_p50_cm": result["metrics"].get("gap_p50_cm"),
                    "sank_mm": result["border"]["deepest_before_mm"],
                    "frames": result["drape"].get("frames"),
                }
            except Exception as error:  # noqa: BLE001 - dev report, keep going
                entry = {"passed": False, "problems": [f"error:{error}"]}
            entry["s"] = round(time.perf_counter() - started, 1)
            report.setdefault(label, {})[name] = entry
            print(label, name, entry, flush=True)
    return report


@dev.local_entrypoint()
def main(jobs: str, out: str) -> None:
    with open(jobs, "r", encoding="utf-8") as handle:
        spec = json.load(handle)
    bodies, garments = {}, {}
    for label, (body_path, garment_path) in spec["bodies"].items():
        with open(body_path, "r", encoding="utf-8") as handle:
            bodies[label] = (json.load(handle)["vertex_positions"], garment_path)
        if garment_path not in garments:
            with open(garment_path, "r", encoding="utf-8") as handle:
                garments[garment_path] = json.load(handle)
    report = run.remote(bodies, garments, spec["mechanical"], spec["variants"])
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=1)
    for label, variants in report.items():
        for name, entry in variants.items():
            print(f"{label:24s} {name:14s} {'PASS' if entry['passed'] else 'FAIL'} sank={entry.get('sank_mm')} "
                  f"stretch_max={entry.get('stretch_max')} {' '.join(entry['problems'])} {entry['s']}s")
