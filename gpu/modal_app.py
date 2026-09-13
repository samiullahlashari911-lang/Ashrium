"""Ashrium VFR on Modal A100-80GB.

Weights live in a Volume (not a 37GB Docker image). Next.js calls the HMAC
HTTP app with fetch. Python inference is gpu/pipeline.py — not Cog.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import sys
import tempfile
import time
from pathlib import Path

import modal

# Pinned git SHAs — keep in sync with gpu/body/pins.py. Do not float on main.
SAM3D_BODY_GIT_SHA = "b5c765a0d89d789985e186d396315e7590887b94"
DETECTRON2_GIT_SHA = "a1ce2f956a1d2212ad672e3c47d53405c2fe4312"
SAM2_GIT_SHA = "2b90b9f5ceec907a1c18123530e92e794ad901a4"
MOGE_GIT_SHA = "07444410f1e33f402353b99d6ccd26bd31e469e8"
GARMENTCODE_GIT_SHA = "55f7edfa9c69a0d487a1d23f59cbdd3fa867ad4f"
DINOV3_GIT_SHA = "346f38fee679c56a6888f91c51670fae61d364e0"
SAM3D_HF_REPO = "facebook/sam-3d-body-dinov3"
SAM2_HF_ID = "facebook/sam2.1-hiera-large"
MOGE_HF_REPO = "Ruicheng/moge-2-vitl-normal"

APP_NAME = "ashrium-vfr-gpu"
GPU_FUNCTION_NAME = "AshriumGpu"
WEIGHTS_MOUNT = "/weights"
GARMENTCODE_ROOT = "/src/garmentcode"
PACKAGE_ROOT = "/opt/ashrium"

app = modal.App(APP_NAME)
weights = modal.Volume.from_name("ashrium-weights", create_if_missing=True)
hf_secret = modal.Secret.from_name("HF_TOKEN")
hmac_secret = modal.Secret.from_name("ASHRIUM_GPU_HMAC")

image = (
    modal.Image.from_registry("pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime")
    .apt_install(
        "git",
        "wget",
        "libgl1",
        "libglib2.0-0",
        "libsm6",
        "libxext6",
        "libxrender1",
        "libegl1",
        "ffmpeg",
        "libcairo2",
        "libpango-1.0-0",
        "libpangocairo-1.0-0",
        "libgdk-pixbuf-2.0-0",
        "shared-mime-info",
    )
    .pip_install_from_requirements("gpu/requirements-modal.txt")
    .run_commands(
        f"git clone https://github.com/facebookresearch/sam-3d-body.git /src/sam-3d-body && git -C /src/sam-3d-body checkout --detach {SAM3D_BODY_GIT_SHA}",
        "python -c \"from pathlib import Path; import site; Path(site.getsitepackages()[0], 'sam3dbody.pth').write_text('/src/sam-3d-body\\n')\"",
        f'pip install --no-build-isolation --no-deps "git+https://github.com/facebookresearch/detectron2.git@{DETECTRON2_GIT_SHA}"',
        f'pip install --no-build-isolation --no-deps "git+https://github.com/facebookresearch/sam2.git@{SAM2_GIT_SHA}"',
        f'pip install "git+https://github.com/microsoft/MoGe.git@{MOGE_GIT_SHA}"',
        f"git clone https://github.com/facebookresearch/dinov3.git /src/dinov3 && git -C /src/dinov3 checkout --detach {DINOV3_GIT_SHA}",
        f"git clone https://github.com/maria-korosteleva/GarmentCode.git {GARMENTCODE_ROOT} && git -C {GARMENTCODE_ROOT} checkout --detach {GARMENTCODE_GIT_SHA}",
    )
    .env(
        {
            "ASHRIUM_WEIGHTS_ROOT": WEIGHTS_MOUNT,
            "GARMENTCODE_ROOT": GARMENTCODE_ROOT,
            "HF_HOME": f"{WEIGHTS_MOUNT}/hf",
            "HF_HUB_CACHE": f"{WEIGHTS_MOUNT}/hf/hub",
            "PYTHONPATH": PACKAGE_ROOT,
        }
    )
    .add_local_dir("gpu", PACKAGE_ROOT, copy=True)
)

web_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("fastapi==0.115.12", "pydantic==2.11.3")
)


def _package_on_path() -> None:
    if PACKAGE_ROOT not in sys.path:
        sys.path.insert(0, PACKAGE_ROOT)


def _write_b64_image(raw_b64: str, dest: Path) -> Path:
    payload = raw_b64.strip()
    if "," in payload and payload.lower().startswith("data:"):
        payload = payload.split(",", 1)[1]
    dest.write_bytes(base64.b64decode(payload))
    return dest


def _verify_hmac(raw_body: bytes, timestamp: str, signature: str) -> None:
    secret = os.environ.get("ASHRIUM_GPU_HMAC", "").strip()
    if len(secret) < 16:
        raise PermissionError("ASHRIUM_GPU_HMAC is not configured.")
    if not timestamp.isdigit():
        raise PermissionError("Missing HMAC timestamp.")
    skew = abs(time.time() - int(timestamp))
    if skew > 300:
        raise PermissionError("HMAC timestamp is stale.")
    expected = hmac.new(
        secret.encode("utf-8"),
        f"{timestamp}.".encode("utf-8") + raw_body,
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, signature.strip().lower()):
        raise PermissionError("HMAC signature is invalid.")


@app.function(
    image=image,
    volumes={WEIGHTS_MOUNT: weights},
    secrets=[hf_secret],
    timeout=3600,
)
def prefetch_weights() -> dict:
    """Download SAM 3D Body, SAM 2, and MoGe-2 into the Modal Volume once."""
    _package_on_path()
    os.environ["ASHRIUM_WEIGHTS_ROOT"] = WEIGHTS_MOUNT
    from huggingface_hub import snapshot_download

    from body.prefetch_weights import configure_hf_cache, hub_cache, read_hf_token
    from body.topology import MOGE_HF_REPO, SAM2_HF_ID, SAM3D_HF_REPO

    configure_hf_cache()
    token = read_hf_token()
    if not token:
        raise RuntimeError("HF_TOKEN Modal secret is required for facebook/sam-3d-body-dinov3.")
    cache = hub_cache()
    for repo in (SAM2_HF_ID, MOGE_HF_REPO, SAM3D_HF_REPO):
        snapshot_download(
            repo_id=repo,
            cache_dir=str(cache),
            token=token if repo == SAM3D_HF_REPO else None,
        )
    weights.commit()
    return {"ok": True, "repos": [SAM2_HF_ID, MOGE_HF_REPO, SAM3D_HF_REPO]}


@app.cls(
    image=image,
    gpu="A100-80GB",
    timeout=300,
    scaledown_window=180,
    min_containers=0,
    max_containers=3,
    volumes={WEIGHTS_MOUNT: weights},
    secrets=[hf_secret],
)
class AshriumGpu:
    @modal.enter()
    def enter(self) -> None:
        _package_on_path()
        os.environ["ASHRIUM_WEIGHTS_ROOT"] = WEIGHTS_MOUNT
        os.environ["GARMENTCODE_ROOT"] = GARMENTCODE_ROOT
        from pipeline import AshriumPipeline

        self.pipeline = AshriumPipeline()
        self.pipeline.setup()

    @modal.method()
    def ping(self) -> dict:
        return {"ok": True, "status": "warm"}

    @modal.method()
    def body(
        self,
        front_image_b64: str,
        side_image_b64: str,
        height_cm: float,
        sex: str,
        weight_kg: float,
    ) -> dict:
        with tempfile.TemporaryDirectory() as tmp:
            front = _write_b64_image(front_image_b64, Path(tmp) / "front.webp")
            side = _write_b64_image(side_image_b64, Path(tmp) / "side.webp")
            return self.pipeline.predict_body(
                front_image=front,
                side_image=side,
                height_cm=float(height_cm),
                sex=sex,
                weight_kg=float(weight_kg or 0),
            )

    @modal.method()
    def drape(
        self,
        collider_positions: str,
        collider_indices: str,
        garment_rest_mesh: str,
        tensile_stiffness: float,
        bending_rigidity: float,
        shear_stiffness: float,
        area_density: float,
        origin_y: float,
    ) -> dict:
        return self.pipeline.predict_drape(
            collider_positions=collider_positions,
            collider_indices=collider_indices,
            garment_rest_mesh=garment_rest_mesh,
            tensile_stiffness=float(tensile_stiffness),
            bending_rigidity=float(bending_rigidity),
            shear_stiffness=float(shear_stiffness),
            area_density=float(area_density),
            origin_y=float(origin_y),
        )

    @modal.method()
    def pattern(
        self,
        product_text: str,
        size_chart: str,
        garment_category: str,
    ) -> dict:
        return self.pipeline.predict_pattern(
            product_text=product_text,
            size_chart=size_chart,
            garment_category=garment_category,
        )


def _scale_gpu(min_containers: int) -> dict:
    n = max(0, int(min_containers))
    cls = modal.Cls.from_name(APP_NAME, GPU_FUNCTION_NAME)
    cls.update_autoscaler(
        min_containers=n,
        max_containers=3,
        scaledown_window=180,
    )
    if n > 0:
        cls().ping.remote()
    return {"ok": True, "min_containers": n}


@app.function(image=web_image, secrets=[hmac_secret], timeout=300)
@modal.asgi_app()
def api():
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.responses import JSONResponse

    web = FastAPI(title="Ashrium VFR GPU")

    def authorize(request: Request, raw: bytes) -> None:
        try:
            _verify_hmac(
                raw,
                request.headers.get("x-ashrium-timestamp", ""),
                request.headers.get("x-ashrium-signature", ""),
            )
        except PermissionError as error:
            raise HTTPException(status_code=401, detail=str(error)) from error

    def read_json(raw: bytes) -> dict:
        if not raw:
            return {}
        import json as json_lib

        parsed = json_lib.loads(raw.decode("utf-8"))
        return parsed if isinstance(parsed, dict) else {}

    @web.post("/session")
    async def session(request: Request) -> JSONResponse:
        raw = await request.body()
        authorize(request, raw)
        payload = read_json(raw)
        action = payload.get("action") if isinstance(payload, dict) else "status"
        requested = payload.get("min_containers") if isinstance(payload, dict) else None
        if action == "warm":
            n = int(requested) if requested is not None else 1
            return JSONResponse(_scale_gpu(max(1, n)))
        if action == "sleep":
            n = int(requested) if requested is not None else 0
            return JSONResponse(_scale_gpu(max(0, n)))
        return JSONResponse({"ok": True, "action": "status", "min_containers": None})

    @web.post("/body")
    async def body(request: Request) -> JSONResponse:
        raw = await request.body()
        authorize(request, raw)
        payload = read_json(raw)
        gpu = AshriumGpu()
        result = gpu.body.remote(
            front_image_b64=str(payload.get("front_image_b64") or ""),
            side_image_b64=str(payload.get("side_image_b64") or ""),
            height_cm=float(payload.get("height_cm") or 0),
            sex=str(payload.get("sex") or "unspecified"),
            weight_kg=float(payload.get("weight_kg") or 0),
        )
        return JSONResponse(result)

    @web.post("/drape")
    async def drape(request: Request) -> JSONResponse:
        raw = await request.body()
        authorize(request, raw)
        payload = read_json(raw)
        gpu = AshriumGpu()
        result = gpu.drape.remote(
            collider_positions=str(payload.get("collider_positions") or ""),
            collider_indices=str(payload.get("collider_indices") or ""),
            garment_rest_mesh=str(payload.get("garment_rest_mesh") or ""),
            tensile_stiffness=float(payload.get("tensile_stiffness") or 75),
            bending_rigidity=float(payload.get("bending_rigidity") or 0.03),
            shear_stiffness=float(payload.get("shear_stiffness") or 45),
            area_density=float(payload.get("area_density") or 0.18),
            origin_y=float(payload.get("origin_y") or 0),
        )
        return JSONResponse(result)

    @web.post("/pattern")
    async def pattern(request: Request) -> JSONResponse:
        raw = await request.body()
        authorize(request, raw)
        payload = read_json(raw)
        gpu = AshriumGpu()
        result = gpu.pattern.remote(
            product_text=str(payload.get("product_text") or ""),
            size_chart=str(payload.get("size_chart") or "[]"),
            garment_category=str(payload.get("garment_category") or "tee"),
        )
        return JSONResponse(result)

    return web
