from fastapi import FastAPI, Header, HTTPException
import hmac
import os
import uuid

from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, HttpUrl

app = FastAPI(title="VFR Local Server Engine")

allowed_origins = [
    origin.strip()
    for origin in os.getenv("ASHRIUM_ALLOWED_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["POST"],
    allow_headers=["Content-Type", "X-Tenant-API-Key"],
)

class FitCheckRequest(BaseModel):
    user_image_urls: list[HttpUrl] = Field(min_length=1, max_length=4)
    garment_sku: str = Field(min_length=1, max_length=128)


class FitCheckResponse(BaseModel):
    job_id: str
    status: str
    result_gltf_url: str | None = None


def require_tenant_api_key(candidate: str) -> None:
    expected = os.getenv("ASHRIUM_FIT_CHECK_API_KEY")

    if not expected:
        raise HTTPException(status_code=503, detail="Fit-check API is not configured.")

    if not hmac.compare_digest(candidate, expected):
        raise HTTPException(status_code=401, detail="Invalid X-Tenant-API-Key header.")

@app.post("/api/v1/fit-check", response_model=FitCheckResponse)
async def trigger_fit_check(
    payload: FitCheckRequest,
    x_tenant_api_key: str = Header(...)
):
    """
    Simulates sending user photos to Replicate HMR 2.0 / Sewformer APIs.
    Costs $0.00 during local development.
    """
    require_tenant_api_key(x_tenant_api_key)

    job_id = str(uuid.uuid4())

    return FitCheckResponse(
        job_id=job_id,
        status="queued",
    )