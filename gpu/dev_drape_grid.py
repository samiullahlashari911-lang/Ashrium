"""Dev-only drape grid: generated MHR bodies × real catalog garments × every size.

Ephemeral (`modal run`, never deployed). Runs the production drape path
(`drape/sewn.py`) on a spread of bodies so a change that breaks one shape or
size shows before a GPU deploy. From the repo root:

    python -m modal run gpu/dev_drape_grid.py --garments tmp/drape-grid/garments.json \
        --out tmp/drape-grid/grid.json [--only crewneck,joggers] [--bodies M1,M7]

Bodies are cached locally (tmp/drape-grid/bodies.json); sewn patterns live on the
`ashrium-dev-grid` Modal volume and re-sew when a garment's name or chart, or the
pattern code, changes.

Bodies are MHR shapes sampled from a fixed seed and fitted to target height and
girths (no photos, no shopper data). Real fitted bodies can be added with
`--extra-bodies path1,path2` (body-result.json files, kept local).
Then render the contact sheets: `python gpu/tools/render_grid.py tmp/drape-grid/grid.json`.
"""

from __future__ import annotations

import base64
import json
import os
import sys
import time

import modal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from modal_app import WEIGHTS_MOUNT, image, weights  # noqa: E402  (same image as production)

dev = modal.App("ashrium-dev-drape-grid")
# Sewn patterns stay on Modal (~4 MB per garment): every body's container reads
# them here instead of each call uploading them from the operator's machine.
grid_volume = modal.Volume.from_name("ashrium-dev-grid", create_if_missing=True)
GRID_MOUNT = "/grid"

# label, stated height, chest, waist, hip (cm). Men slim → very heavy, women a spread.
BODY_TARGETS = [
    ("M1 slim short", 165, 88, 74, 90),
    ("M2 slim tall", 188, 92, 78, 94),
    ("M3 average", 175, 98, 86, 98),
    ("M4 athletic", 180, 108, 84, 100),
    ("M5 stocky", 170, 108, 100, 104),
    ("M6 heavy", 178, 118, 112, 112),
    ("M7 very heavy", 182, 128, 124, 120),
    ("M8 tall broad", 193, 112, 96, 106),
    ("F1 petite", 158, 84, 66, 92),
    ("F2 average", 165, 92, 74, 100),
    ("F3 curvy", 170, 104, 90, 112),
    ("F4 plus", 162, 116, 104, 124),
]
SEED = 20261010
SAMPLES_PER_SIGMA = 160
SIGMAS = (0.8, 1.6, 2.4)
REFINE_STEPS = 40
HEIGHT_ITERATIONS = 6


def _b64(array, dtype: str) -> str:
    import numpy as np

    return base64.b64encode(np.ascontiguousarray(array, dtype=dtype).tobytes()).decode("ascii")


def _load_mhr():
    import torch

    from body.prefetch_weights import configure_hf_cache, snapshot_dir_for
    from body.topology import SAM3D_HF_REPO

    configure_hf_cache()
    snap = snapshot_dir_for(SAM3D_HF_REPO)
    if snap is None:
        raise RuntimeError("SAM 3D Body snapshot (assets/mhr_model.pt) is not on the weights volume.")
    module = torch.jit.load(str(snap / "assets" / "mhr_model.pt"), map_location="cuda")
    module.eval()
    return module


@dev.function(image=image, gpu=["A100-80GB", "A100-40GB", "L40S"], timeout=1800, volumes={WEIGHTS_MOUNT: weights})
def make_bodies(targets: list[list]) -> list[dict]:
    """Fit sampled MHR identities to each (height, chest, waist, hip) target, canonical pose."""
    import numpy as np
    import torch

    if "/opt/ashrium" not in sys.path:
        sys.path.insert(0, "/opt/ashrium")
    from body.girths import measure_chest_waist_hip_cm
    from body.mhr_fit import _forward_mhr, _pad_identity, canonical_model_params, mesh_stature_cm
    from body.topology import MHR_BODY_IDENTITY_DIM, MHR_SKELETON_DIM

    mhr = _load_mhr()
    face = torch.zeros(1, 72, device="cuda")
    hands = torch.zeros(1, 5, device="cuda")

    def canonical(body20: np.ndarray, height: float) -> tuple[np.ndarray, np.ndarray]:
        """Canonical mesh (cm) at the stated height: skeleton scale moved along ∇stature."""
        identity = _pad_identity(torch.tensor(body20, device="cuda", dtype=torch.float32)[None], hands)
        scale = torch.zeros(1, MHR_SKELETON_DIM, device="cuda", requires_grad=True)
        for _ in range(HEIGHT_ITERATIONS):
            verts, _skel = _forward_mhr(mhr, identity, canonical_model_params(scale), face)
            stature = mesh_stature_cm(verts).reshape(-1)[0]
            grad = torch.autograd.grad(stature, scale)[0]
            with torch.no_grad():
                scale += grad * (height - stature.detach()) / grad.pow(2).sum().clamp(min=1e-8)
        with torch.no_grad():
            verts, _skel = _forward_mhr(mhr, identity, canonical_model_params(scale), face)
        return verts[0].cpu().numpy().astype(np.float64), scale.detach().cpu().numpy()[0]

    def score(girths: dict, target: list) -> float:
        _label, _height, chest, waist, hip = target
        return (
            (girths["chest_cm"] - chest) ** 2 + (girths["waist_cm"] - waist) ** 2 + (girths["hip_cm"] - hip) ** 2
        )

    rng = np.random.default_rng(SEED)
    pool = np.concatenate([rng.normal(0.0, sigma, (SAMPLES_PER_SIGMA, MHR_BODY_IDENTITY_DIM)) for sigma in SIGMAS])
    # Girths at the pool's own height, rescaled to each target height (refined exactly below).
    pool_girths = []
    for body20 in pool:
        verts, _scale = canonical(body20, 175.0)
        try:
            pool_girths.append(measure_chest_waist_hip_cm(verts))
        except RuntimeError:
            pool_girths.append(None)

    bodies = []
    for target in targets:
        label, height = target[0], float(target[1])
        ratio = height / 175.0
        candidates = [
            (score({k: v * ratio for k, v in g.items()}, target), i) for i, g in enumerate(pool_girths) if g is not None
        ]
        best = pool[min(candidates)[1]].copy()
        verts, scale = canonical(best, height)
        girths = measure_chest_waist_hip_cm(verts)
        best_score = score(girths, target)
        for step in range(REFINE_STEPS):
            trial = best + rng.normal(0.0, 0.35 if step < REFINE_STEPS // 2 else 0.15, best.shape)
            trial_verts, trial_scale = canonical(trial, height)
            try:
                trial_girths = measure_chest_waist_hip_cm(trial_verts)
            except RuntimeError:
                continue
            trial_score = score(trial_girths, target)
            if trial_score < best_score:
                best, verts, scale, girths, best_score = trial, trial_verts, trial_scale, trial_girths, trial_score
        bodies.append({
            "label": label,
            "target": {"height": height, "chest": target[2], "waist": target[3], "hip": target[4]},
            "height_cm": round(float(verts[:, 1].max() - verts[:, 1].min()), 2),
            "girths": {key: round(float(value), 1) for key, value in girths.items()},
            "identity": best.tolist(),
            "scale": scale.tolist(),
            "vertices_cm": _b64(verts, "<f4"),
        })
        print(label, bodies[-1]["height_cm"], bodies[-1]["girths"], flush=True)
    return bodies


@dev.function(image=image, cpu=1.0, timeout=120, volumes={GRID_MOUNT: grid_volume})
def pattern_fingerprints() -> dict[str, str]:
    """Fingerprint of every pattern already sewn on the grid volume."""
    out = {}
    for name in os.listdir(f"{GRID_MOUNT}/patterns") if os.path.isdir(f"{GRID_MOUNT}/patterns") else []:
        with open(f"{GRID_MOUNT}/patterns/{name}", "r", encoding="utf-8") as handle:
            out[name.removesuffix(".json")] = json.load(handle).get("fingerprint", "")
    return out


@dev.function(image=image, cpu=4.0, memory=8192, timeout=1200, volumes={GRID_MOUNT: grid_volume})
def make_pattern(garment: dict, fingerprint: str) -> dict:
    """Sew every chart size of one garment onto the grid volume (CPU; shared by every body)."""
    if "/opt/ashrium" not in sys.path:
        sys.path.insert(0, "/opt/ashrium")
    from pattern.instantiate import instantiate_patterns

    result = instantiate_patterns(garment["category"], garment["name"], json.dumps(garment["chart"]), sew=True)
    pattern = {
        "key": garment["key"],
        "fingerprint": fingerprint,
        "status": result["status"],
        "reason": result["unsupported_reason"],
        "sizes": [
            {"size": rest["sizeCode"], "pattern_girths": rest["pattern_girths"], "garment_mesh": rest["garment_mesh"]}
            for rest in result["meshes"]
        ],
    }
    os.makedirs(f"{GRID_MOUNT}/patterns", exist_ok=True)
    with open(f"{GRID_MOUNT}/patterns/{garment['key']}.json", "w", encoding="utf-8") as handle:
        json.dump(pattern, handle)
    grid_volume.commit()
    return {"key": garment["key"], "status": pattern["status"], "reason": pattern["reason"]}


@dev.function(
    image=image,
    gpu=["A100-80GB", "A100-40GB", "L40S"],
    timeout=3600,
    volumes={WEIGHTS_MOUNT: weights, GRID_MOUNT: grid_volume},
)
def drape_body(body: dict, garments: list[dict], variant: dict | None = None) -> dict:
    """Every size of every garment on one body, through the production drape path."""
    import traceback

    import numpy as np

    if "/opt/ashrium" not in sys.path:
        sys.path.insert(0, "/opt/ashrium")
    os.environ.setdefault("ASHRIUM_WARP_CACHE", f"{WEIGHTS_MOUNT}/warp-cache")
    from body.girths import measure_chest_waist_hip_cm, torso_landmarks_cm
    from body.photo_uv import mhr_lod1_faces
    from drape.sewn import body_collider, drape_sewn_size, too_small

    started = time.perf_counter()
    verts_cm = np.frombuffer(base64.b64decode(body["vertices_cm"]), dtype="<f4").reshape(-1, 3).astype(np.float64)
    faces = mhr_lod1_faces()
    body_m = verts_cm / 100.0
    girths = measure_chest_waist_hip_cm(verts_cm)
    landmarks = torso_landmarks_cm(verts_cm)
    waist_y = None if landmarks is None else landmarks["waist_y"] / 100.0
    collider_positions, collider_faces, inflate_m = body_collider(body_m, faces)

    results = []
    for garment in garments:
        category = garment["category"]
        with open(f"{GRID_MOUNT}/patterns/{garment['key']}.json", "r", encoding="utf-8") as handle:
            pattern = json.load(handle)
        if pattern["status"] != "ok":
            results.append({"garment": garment["key"], "status": pattern["status"], "reason": pattern["reason"]})
            continue
        for rest in pattern["sizes"]:
            entry = {"garment": garment["key"], "size": rest["size"], "pattern_girths": rest["pattern_girths"]}
            mesh = rest["garment_mesh"]
            reason = too_small(category, rest["pattern_girths"], girths, bool(mesh.get("elastic_waist")))
            if reason:
                results.append({**entry, "status": "too_small", "reason": reason})
                continue
            step = time.perf_counter()
            try:
                out = drape_sewn_size(
                    rest["garment_mesh"], category, body_m, faces, (collider_positions, collider_faces),
                    garment["mechanical"], waist_y=waist_y,
                    solver=(variant or {}).get("solver"), arrange_options=(variant or {}).get("arrange"),
                )
            except Exception as error:  # the grid records failures; production surfaces them
                results.append({**entry, "status": "failed", "reason": str(error),
                                "traceback": traceback.format_exc()[-2000:]})
                continue
            results.append({
                **entry,
                "status": "ok" if out["passed"] else "problem",
                "problems": out["problems"],
                "metrics": out["metrics"],
                "border": out["border"],
                "converged": out["drape"]["converged"],
                "frames_run": out["drape"]["frames_run"],
                "ms": round((time.perf_counter() - step) * 1000.0, 1),
                "positions": _b64(out["positions"], "<f2"),
                "triangles": _b64(out["triangles"], "<i4"),
                "gap_cm": _b64(out["fit_gap_m"] * 100.0, "<f2"),
            })
    weights.commit()  # keep the compiled-kernel cache for the next container
    return {
        "label": body["label"],
        "girths": girths,
        "landmarks": landmarks,
        "collider_inflate_mm": round(inflate_m * 1000.0, 1),
        "results": results,
        "ms": round((time.perf_counter() - started) * 1000.0, 1),
    }


@dev.local_entrypoint()
def main(
    garments: str = "tmp/drape-grid/garments.json",
    out: str = "tmp/drape-grid/grid.json",
    bodies_cache: str = "tmp/drape-grid/bodies.json",
    only: str = "",
    bodies: str = "",
    variant: str = "",
    extra_bodies: str = "",
) -> None:
    """`only`: garment keys; `bodies`: label prefixes (e.g. M1,M7); `extra_bodies`: body-result.json paths."""
    import numpy as np

    with open(garments, "r", encoding="utf-8") as handle:
        garment_list = json.load(handle)
    if only:
        keys = set(only.split(","))
        garment_list = [garment for garment in garment_list if garment["key"] in keys]

    if os.path.isfile(bodies_cache):
        with open(bodies_cache, "r", encoding="utf-8") as handle:
            body_list = json.load(handle)
    else:
        body_list = make_bodies.remote([list(target) for target in BODY_TARGETS])
        with open(bodies_cache, "w", encoding="utf-8") as handle:
            json.dump(body_list, handle)
    for path in filter(None, extra_bodies.split(",")):
        with open(path, "r", encoding="utf-8") as handle:
            fitted = json.load(handle)
        verts = np.asarray(fitted["vertex_positions"], dtype=np.float32).reshape(-1, 3)
        body_list.append({
            "label": "R " + os.path.basename(os.path.dirname(os.path.abspath(path))),
            "girths": fitted["derived_measurements"],
            "vertices_cm": base64.b64encode(verts.tobytes()).decode("ascii"),
        })
    if bodies:
        prefixes = tuple(bodies.split(","))
        body_list = [body for body in body_list if body["label"].startswith(prefixes)]

    # Patterns depend on the garment (name, chart) and the pattern code: sewn once
    # onto the grid volume, re-sewn when either changes.
    import hashlib
    import pathlib

    source = hashlib.sha256(b"".join(
        path.read_bytes() for path in sorted((pathlib.Path(__file__).parent / "pattern").glob("*.py"))
    )).hexdigest()
    fingerprint = {
        garment["key"]: json.dumps([garment["name"], garment["chart"], source], sort_keys=True) for garment in garment_list
    }
    sewn = pattern_fingerprints.remote()
    missing = [garment for garment in garment_list if sewn.get(garment["key"]) != fingerprint[garment["key"]]]
    # An empty starmap never returns (Modal 1.5): only call it with work to do.
    if missing:
        for summary in make_pattern.starmap([(garment, fingerprint[garment["key"]]) for garment in missing]):
            print("sewn", summary, flush=True)

    # One variant (a JSON object) or several ([{"name": ..., "arrange": ..., "solver": ...}]):
    # every body x variant is its own container in this one app.
    parsed = json.loads(variant) if variant else None
    variants = parsed if isinstance(parsed, list) else [{"name": "", **(parsed or {})}]
    pairs = [(body, chosen) for chosen in variants for body in body_list]
    started = time.perf_counter()
    rows = list(drape_body.starmap(
        [(body, garment_list, chosen) for body, chosen in pairs], return_exceptions=True
    ))
    wall_ms = round((time.perf_counter() - started) * 1000.0, 1)
    for chosen in variants:
        target = out if not chosen.get("name") else out.replace(".json", f"-{chosen['name']}.json")
        report = {"bodies": [], "garments": garment_list, "variant": chosen, "wall_ms": wall_ms}
        for (body, used), row in zip(pairs, rows):
            if used is not chosen:
                continue
            if isinstance(row, Exception):
                report["bodies"].append({"label": body["label"], "error": repr(row), "results": []})
                continue
            row["vertices_cm"] = body["vertices_cm"]
            report["bodies"].append(row)
        with open(target, "w", encoding="utf-8") as handle:
            json.dump(report, handle)
        _print_report(report, chosen.get("name", ""))


def _print_report(report: dict, name: str) -> None:
    total = {"ok": 0, "problem": 0, "too_small": 0, "failed": 0}
    for body in report["bodies"]:
        if body.get("error"):
            print(body["label"], "ERROR", body["error"][:300])
            continue
        print(f"{body['label']:16s} {json.dumps({k: round(v, 1) for k, v in body['girths'].items()})} {body['ms'] / 1000:.0f}s")
        for result in body["results"]:
            total[result["status"]] = total.get(result["status"], 0) + 1
            detail = result.get("reason") or "; ".join(f"{p['level']}:{p['code']}" for p in result.get("problems", []))
            metrics = result.get("metrics", {})
            print(f"   {result['garment']:9s} {result.get('size', '-'):5s} {result['status']:9s} "
                  f"p99x{metrics.get('stretch_p99', '-')} gap{metrics.get('gap_max_cm', '-')} {result.get('ms', '')} {detail}")
    print("TOTAL", name, total, f"wall {report['wall_ms'] / 1000:.0f}s")
