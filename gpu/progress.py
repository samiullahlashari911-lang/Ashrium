"""Stage callbacks from task=body back to the Next.js app (shopper loading pill).

The app passes `progress = {"url", "job_id", "tenant_id"}` with each body call.
Each stage is POSTed with the same HMAC scheme the app uses toward Modal
(`X-Ashrium-Timestamp` / `X-Ashrium-Signature` over "{timestamp}.{body}").

Fire-and-forget on a daemon thread with a short timeout: a slow or failing
callback must never slow down or fail avatar inference.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import threading
import time
import urllib.request
from typing import Callable

REPORTED_STAGES = frozenset({"silhouettes", "body", "measure"})
CALLBACK_TIMEOUT_S = 3.0

StageReporter = Callable[[str], None]


def sign(raw: bytes, timestamp: str, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), f"{timestamp}.".encode("utf-8") + raw, hashlib.sha256).hexdigest()


def _post(url: str, payload: dict, secret: str) -> None:
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    timestamp = str(int(time.time()))
    request = urllib.request.Request(
        url,
        data=raw,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Ashrium-Timestamp": timestamp,
            "X-Ashrium-Signature": sign(raw, timestamp, secret),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=CALLBACK_TIMEOUT_S) as response:
            response.read()
    except Exception as error:  # noqa: BLE001 — progress is best-effort by design
        print(f"progress callback skipped: {error}", flush=True)


def make_stage_reporter(progress: object) -> StageReporter:
    """Returns a reporter for a valid progress spec, else a no-op."""
    secret = os.environ.get("ASHRIUM_GPU_HMAC", "").strip()
    if not isinstance(progress, dict) or len(secret) < 16:
        return lambda _stage: None

    url = progress.get("url")
    job_id = progress.get("job_id")
    tenant_id = progress.get("tenant_id")
    if not (isinstance(url, str) and url.startswith("https://") or isinstance(url, str) and url.startswith("http://localhost")):
        return lambda _stage: None
    if not isinstance(job_id, str) or not isinstance(tenant_id, str):
        return lambda _stage: None

    def report(stage: str) -> None:
        if stage not in REPORTED_STAGES:
            return
        payload = {"job_id": job_id, "tenant_id": tenant_id, "stage": stage}
        threading.Thread(target=_post, args=(url, payload, secret), daemon=True).start()

    return report
