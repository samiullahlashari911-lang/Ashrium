"""Non-biometric Cog stage timings and fit diagnostics. No photos or faces."""

from __future__ import annotations

import time
from typing import Any

# Must match types/hmr.ts `MHR_STAGE_TIMING_KEYS` / `MhrFitDiagnostics`.
STAGE_TIMING_KEYS: tuple[str, ...] = (
    "setup",
    "sam2_front",
    "sam2_side",
    "sam3d_front",
    "sam3d_side",
    "mhr_fit",
    "serialization",
)
DIAGNOSTIC_METRIC_KEYS: tuple[str, ...] = (
    "iteration_count",
    "native_joint_rmse_cm",
    "height_residual_cm",
    "silhouette_residual",
)


def elapsed_ms(started: float) -> float:
    return max(0.0, (time.perf_counter() - started) * 1000.0)


class StageClock:
    """Record named wall-clock spans in milliseconds."""

    def __init__(self) -> None:
        self._marks: dict[str, float] = {}

    def measure(self, name: str) -> "_StageSpan":
        return _StageSpan(self, name)

    def set(self, name: str, milliseconds: float) -> None:
        if name not in STAGE_TIMING_KEYS:
            return
        if milliseconds >= 0 and milliseconds == milliseconds:
            self._marks[name] = float(milliseconds)

    def subtract(self, name: str, milliseconds: float) -> None:
        if name not in STAGE_TIMING_KEYS:
            return
        current = self._marks.get(name)
        if current is None:
            return
        self._marks[name] = max(0.0, current - float(milliseconds))

    def as_dict(self) -> dict[str, float]:
        return {
            name: round(self._marks[name], 3)
            for name in STAGE_TIMING_KEYS
            if name in self._marks
        }


class _StageSpan:
    def __init__(self, clock: StageClock, name: str) -> None:
        self._clock = clock
        self._name = name
        self._started = 0.0

    def __enter__(self) -> "_StageSpan":
        self._started = time.perf_counter()
        return self

    def __exit__(self, *_exc: object) -> None:
        self._clock.set(self._name, elapsed_ms(self._started))


def finite_metric(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def _store_metric(bucket: dict[str, Any], key: str, value: Any) -> None:
    if key not in DIAGNOSTIC_METRIC_KEYS:
        return
    metric = finite_metric(value)
    if metric is None:
        return
    if key == "iteration_count":
        if metric < 0:
            return
        bucket[key] = int(metric)
        return
    if metric < 0:
        return
    bucket[key] = metric


def _store_timings(bucket: dict[str, float], source: dict[str, Any]) -> None:
    for name in STAGE_TIMING_KEYS:
        if name not in source:
            continue
        metric = finite_metric(source[name])
        if metric is None or metric < 0:
            continue
        bucket[name] = round(metric, 3)


def merge_fit_diagnostics(
    result: dict[str, Any],
    *,
    stage_timings_ms: dict[str, float] | None = None,
    **metrics: Any,
) -> dict[str, Any]:
    """Attach allowlisted non-biometric diagnostics. Never stores images or landmarks."""
    incoming = result.get("fit_diagnostics")
    previous = incoming if isinstance(incoming, dict) else {}

    diagnostics: dict[str, Any] = {}
    for key in DIAGNOSTIC_METRIC_KEYS:
        if key in previous:
            _store_metric(diagnostics, key, previous[key])
    for key, value in metrics.items():
        _store_metric(diagnostics, key, value)

    timings: dict[str, float] = {}
    previous_timings = previous.get("stage_timings_ms")
    if isinstance(previous_timings, dict):
        _store_timings(timings, previous_timings)
    if stage_timings_ms:
        _store_timings(timings, stage_timings_ms)
    if timings:
        diagnostics["stage_timings_ms"] = timings

    if diagnostics:
        result["fit_diagnostics"] = diagnostics
    elif "fit_diagnostics" in result:
        del result["fit_diagnostics"]
    return result
