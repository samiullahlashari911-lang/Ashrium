"""Baked HuggingFace snapshot contract for the Cog image."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

COG_ROOT = Path(__file__).resolve().parents[1]
if str(COG_ROOT) not in sys.path:
    sys.path.insert(0, str(COG_ROOT))

from body.prefetch_weights import (  # noqa: E402
    BAKED_HF_REPOS,
    GATED_HF_REPOS,
    PUBLIC_HF_REPOS,
    weights_root,
)
from body.topology import MOGE_HF_REPO, SAM2_HF_ID, SAM3D_HF_REPO


class PrefetchContractTests(unittest.TestCase):
    def test_baked_repos_are_the_live_pipeline(self) -> None:
        self.assertEqual(SAM3D_HF_REPO, "facebook/sam-3d-body-dinov3")
        self.assertEqual(SAM2_HF_ID, "facebook/sam2.1-hiera-large")
        self.assertEqual(MOGE_HF_REPO, "Ruicheng/moge-2-vitl-normal")
        self.assertEqual(GATED_HF_REPOS, (SAM3D_HF_REPO,))
        self.assertEqual(PUBLIC_HF_REPOS, (SAM2_HF_ID, MOGE_HF_REPO))
        self.assertEqual(BAKED_HF_REPOS, PUBLIC_HF_REPOS + GATED_HF_REPOS)

    def test_host_weights_are_under_cog_weights(self) -> None:
        root = weights_root()
        self.assertEqual(root.name, "weights")
        self.assertEqual(root.parent.name, "cog")

    def test_dockerignore_copies_baked_weights(self) -> None:
        ignore = Path(__file__).resolve().parents[1] / ".dockerignore"
        text = ignore.read_text(encoding="utf-8")
        self.assertNotIn("*.pt", text.splitlines())
        self.assertNotIn("*.ckpt", text.splitlines())
        self.assertIn("weights/", text)
        self.assertIn("MUST be copied", text)


if __name__ == "__main__":
    unittest.main()
