"""Reviewed git SHAs for Cog image builds. Keep in sync with cog/cog.yaml.

A rebuild must not float on `main`. Tests assert every SHA appears in cog.yaml.
"""

from __future__ import annotations

# facebookresearch/sam-3d-body — includes official 204-value mhr_model_params
# (parent c259bfc) and the 127-joint native layout used for girths.
SAM3D_BODY_GIT_SHA = "b5c765a0d89d789985e186d396315e7590887b94"
# Detectron2 pin from SAM 3D Body INSTALL.md (`a1ce2f9`).
DETECTRON2_GIT_SHA = "a1ce2f956a1d2212ad672e3c47d53405c2fe4312"
# facebookresearch/sam2 — SAM 2.1 Hiera Large predictor used for silhouettes.
SAM2_GIT_SHA = "2b90b9f5ceec907a1c18123530e92e794ad901a4"
# microsoft/MoGe — last MoGe-2 tree (`moge.model.v2`) before V3; fov_name=moge2.
MOGE_GIT_SHA = "07444410f1e33f402353b99d6ccd26bd31e469e8"
# maria-korosteleva/GarmentCode MIT v2.0.2.
GARMENTCODE_GIT_SHA = "55f7edfa9c69a0d487a1d23f59cbdd3fa867ad4f"
# facebookresearch/dinov3 — SAM 3D Body torch.hub default is unpinned `main`.
DINOV3_GIT_SHA = "346f38fee679c56a6888f91c51670fae61d364e0"

PINNED_GIT_SHAS: tuple[str, ...] = (
    SAM3D_BODY_GIT_SHA,
    DETECTRON2_GIT_SHA,
    SAM2_GIT_SHA,
    MOGE_GIT_SHA,
    GARMENTCODE_GIT_SHA,
    DINOV3_GIT_SHA,
)
