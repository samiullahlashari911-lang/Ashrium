"""HTML / product-text parse → GarmentCode design flags.

Qwen3-VL is not used: an 8B VL stack on the trial A100 would starve body/drape.
Unsupported geometry (hoods, lapels, cargo, knits) fails closed — Approximate / no 3D.
"""

from __future__ import annotations

import re
from typing import Any

SUPPORTED_CATEGORIES = frozenset({"tee", "pant", "dress", "outerwear"})

_HOOD = re.compile(r"\b(hood|hoodie|hooded)\b", re.I)
_LAPEL = re.compile(r"\b(lapel|blazer|suit\s+jacket|notch\s+collar|double[-\s]?breasted)\b", re.I)
_CARGO = re.compile(r"\b(cargo)\b", re.I)
_KNIT = re.compile(
    r"\b(sweater|jumper|cardigan|knitwear|cable[-\s]?knit|ribbed\s+knit|wool\s+knit|merino\s+knit)\b",
    re.I,
)
_JUMPSUIT = re.compile(r"\b(jumpsuit|romper|overall)\b", re.I)
_SLEEVELESS = re.compile(r"\b(sleeveless|tank\s+top|\btank\b|vest)\b", re.I)
_LONG_SLEEVE = re.compile(r"\b(long[-\s]?sleeve|full[-\s]?sleeve)\b", re.I)
_THREE_QUARTER = re.compile(r"\b(3/?4[-\s]?sleeve|three[-\s]?quarter)\b", re.I)


def _corpus(product_text: str) -> str:
    return " ".join(product_text.split())


def detect_unsupported(category: str, product_text: str) -> str | None:
    if category not in SUPPORTED_CATEGORIES:
        return "unsupported category"
    text = _corpus(product_text)
    if _HOOD.search(text):
        return "hood"
    if _LAPEL.search(text):
        return "lapel"
    if _CARGO.search(text):
        return "cargo"
    if _KNIT.search(text):
        return "knit"
    if _JUMPSUIT.search(text):
        return "jumpsuit"
    return None


def parse_style(category: str, product_text: str) -> dict[str, Any]:
    reason = detect_unsupported(category, product_text)
    text = _corpus(product_text)
    sleeveless = bool(_SLEEVELESS.search(text))
    sleeve_length = 0.3
    if sleeveless:
        sleeve_length = 0.1
    elif _LONG_SLEEVE.search(text) or category == "outerwear":
        sleeve_length = 0.95
    elif _THREE_QUARTER.search(text):
        sleeve_length = 0.6

    shirt_width = 1.15 if category == "outerwear" else 1.05
    upper = None if category == "pant" else "Shirt"
    bottom = "Pants" if category == "pant" else None

    return {
        "unsupported_reason": reason,
        "upper": upper,
        "bottom": bottom,
        "sleeveless": sleeveless,
        "sleeve_length": sleeve_length,
        "shirt_width": shirt_width,
        "category": category,
    }
