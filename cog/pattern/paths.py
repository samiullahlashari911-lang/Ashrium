"""Locate the cloned GarmentCode (MIT) tree inside the Cog image."""

from __future__ import annotations

import os
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent
COG_ROOT = PACKAGE_ROOT.parent

_CANDIDATES = (
    os.environ.get("GARMENTCODE_ROOT", "").strip(),
    "/src/garmentcode",
    str(COG_ROOT / "vendor" / "GarmentCode"),
)


def garmentcode_root() -> Path:
    for raw in _CANDIDATES:
        if not raw:
            continue
        root = Path(raw)
        programs = root / "assets" / "garment_programs" / "meta_garment.py"
        bodies = root / "assets" / "bodies" / "mean_all.yaml"
        design = root / "assets" / "design_params" / "t-shirt.yaml"
        if programs.is_file() and bodies.is_file() and design.is_file():
            return root
    raise RuntimeError(
        "GarmentCode MIT assets are missing. Clone maria-korosteleva/GarmentCode "
        "(v2.0.2) into /src/garmentcode at image build. Never NvidiaWarp-GarmentCode."
    )


def body_yaml_path() -> Path:
    return garmentcode_root() / "assets" / "bodies" / "mean_all.yaml"


def design_yaml_path() -> Path:
    return garmentcode_root() / "assets" / "design_params" / "t-shirt.yaml"
