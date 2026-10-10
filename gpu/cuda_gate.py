"""Keep Warp CUDA-graph capture apart from PyTorch work in the same container.

Warp captures on a blocking stream; while it records, any PyTorch kernel on
the legacy default stream fails with "operation would make the legacy stream
depend on a capturing blocking stream" (two shopper /body calls failed this
way on 2026-10-10 while the drape warm-up captured). PyTorch work holds the
gate shared; a capture asks for it exclusively and, if a body is running,
the drape simply runs without a graph (same physics, more launch overhead).
"""

from __future__ import annotations

import threading
from contextlib import contextmanager
from typing import Iterator

_condition = threading.Condition()
_torch_users = 0
_capturing = False


@contextmanager
def torch_work() -> Iterator[None]:
    """PyTorch on the GPU: waits out a capture in progress (milliseconds)."""
    global _torch_users
    with _condition:
        _condition.wait_for(lambda: not _capturing)
        _torch_users += 1
    try:
        yield
    finally:
        with _condition:
            _torch_users -= 1
            _condition.notify_all()


@contextmanager
def exclusive_capture(timeout_s: float = 0.0) -> Iterator[bool]:
    """Yields True when no PyTorch work runs and capture may begin, else False."""
    global _capturing
    with _condition:
        granted = _condition.wait_for(lambda: _torch_users == 0 and not _capturing, timeout_s)
        if granted:
            _capturing = True
    try:
        yield granted
    finally:
        if granted:
            with _condition:
                _capturing = False
                _condition.notify_all()
