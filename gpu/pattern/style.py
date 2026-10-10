"""HTML / product-text parse → GarmentCode design flags.

Qwen3-VL is not used: an 8B VL stack on the trial A100 would starve body/drape.
Unsupported geometry (hoods, lapels, cardigans, jumpsuits, long sleeves) fails
closed — Approximate / no 3D. Cargo trousers sew as plain trousers (pockets are
not drawn), owner 2026-10-10. Long sleeves tore at the cap on every body of the
drape grid (g6: 43 of 43 sweater drapes); swinging the sleeve onto the arm made
it worse (s1), so they stay off until the drape handles them.
"""

from __future__ import annotations

import re
from typing import Any

# GarmentCode cuts the sleeve for an arm angle below horizontal (10-50).
# Its t-shirt template uses 10 (arms nearly level): on the ~45 deg A-pose
# drape body the spare cloth bunched on top and the underarm pulled tight
# instead of hanging (owner, 2026-10-10). 45 matches the arm angle GarmentCode
# places the sleeve at (mean body arm_pose_angle 45.5) and real tee caps.
SLEEVE_ANGLE_DEG = 45

# A crewneck's cut neckline: ~49.6 cm round and ~9.6 cm deep at the front on
# a size M (before the rib band). GarmentCode's t-shirt template neckline was a
# 70 cm, 15.7 cm deep scoop (owner Q30, 2026-10-10). Style, not a chart size.
CREWNECK_COLLAR = {"collar_width": -0.3, "collar_fc_depth": 0.06}
_CREWNECK = re.compile(r"\bcrew[-\s]?neck|\bcrew\b", re.I)

SUPPORTED_CATEGORIES = frozenset({"tee", "pant", "dress", "outerwear"})

_HOOD = re.compile(r"\b(hood|hoodie|hooded)\b", re.I)
_LAPEL = re.compile(r"\b(lapel|blazer|suit\s+jacket|notch\s+collar|double[-\s]?breasted)\b", re.I)
# An open-front knit drawn as a closed top would misstate the garment.
_CARDIGAN = re.compile(r"\b(cardigans?)\b", re.I)
# Pullovers have long sleeves even when the title does not say so; until long
# sleeves drape (see above) they are unsupported rather than drawn short.
_PULLOVER = re.compile(r"\b(sweaters?|jumpers?|pullovers?|sweatshirts?|quarter[-\s]?zip)\b", re.I)
_JUMPSUIT = re.compile(r"\b(jumpsuit|romper|overall)\b", re.I)
_SLEEVELESS = re.compile(r"\b(sleeveless|tank\s+top|\btank\b|vest)\b", re.I)
_LONG_SLEEVE = re.compile(r"\b(long[-\s]?sleeve|full[-\s]?sleeve)\b", re.I)
_THREE_QUARTER = re.compile(r"\b(3/?4[-\s]?sleeve|three[-\s]?quarter)\b", re.I)
# Gathered waists: the sewn waist is wider than the relaxed chart waist.
_ELASTIC_WAIST = re.compile(
    r"\b(elastic|drawstring|jogger|joggers|legging|leggings|sweatpants?|pull[-\s]?on|smocked)\b", re.I
)


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
    if _CARDIGAN.search(text):
        return "knit"
    if category == "outerwear" or _LONG_SLEEVE.search(text) or _PULLOVER.search(text):
        return "long sleeve"
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
    elif _LONG_SLEEVE.search(text) or _PULLOVER.search(text) or category == "outerwear":
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
        "elastic_waist": bool(_ELASTIC_WAIST.search(text)),
        "sleeve_angle": SLEEVE_ANGLE_DEG,
        **(CREWNECK_COLLAR if upper and _CREWNECK.search(text) else {}),
    }
