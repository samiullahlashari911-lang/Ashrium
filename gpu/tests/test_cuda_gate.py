"""cuda_gate: a Warp graph capture never starts while PyTorch work runs."""

from __future__ import annotations

import sys
import threading
import time
from pathlib import Path

GPU_ROOT = Path(__file__).resolve().parents[1]
if str(GPU_ROOT) not in sys.path:
    sys.path.insert(0, str(GPU_ROOT))

from cuda_gate import exclusive_capture, torch_work  # noqa: E402


def test_capture_refused_while_a_body_runs() -> None:
    with torch_work():
        with exclusive_capture(0.05) as granted:
            assert granted is False


def test_capture_granted_when_idle_and_released_after() -> None:
    with exclusive_capture() as granted:
        assert granted is True
    with exclusive_capture() as granted_again:
        assert granted_again is True


def test_body_waits_for_a_capture_in_progress() -> None:
    order: list[str] = []

    def body() -> None:
        with torch_work():
            order.append("body")

    with exclusive_capture() as granted:
        assert granted
        worker = threading.Thread(target=body)
        worker.start()
        time.sleep(0.05)
        order.append("capture done")
    worker.join(timeout=2)
    assert order == ["capture done", "body"]


def test_capture_waits_for_a_short_body() -> None:
    started = threading.Event()

    def body() -> None:
        with torch_work():
            started.set()
            time.sleep(0.05)

    worker = threading.Thread(target=body)
    worker.start()
    started.wait(1)
    with exclusive_capture(2.0) as granted:
        assert granted
    worker.join(timeout=2)
