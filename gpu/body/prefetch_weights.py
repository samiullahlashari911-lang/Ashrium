"""Download HuggingFace checkpoints into ASHRIUM_WEIGHTS_ROOT.

On Modal that is the `/weights` Volume. SAM 3D Body is gated and needs HF_TOKEN.
Do not stub the initializer.
"""

from __future__ import annotations

import os
import shutil
import sys
from collections import defaultdict
from pathlib import Path

from .topology import MOGE_HF_REPO, SAM2_HF_ID, SAM3D_HF_REPO

PUBLIC_HF_REPOS: tuple[str, ...] = (SAM2_HF_ID, MOGE_HF_REPO)
GATED_HF_REPOS: tuple[str, ...] = (SAM3D_HF_REPO,)
BAKED_HF_REPOS: tuple[str, ...] = PUBLIC_HF_REPOS + GATED_HF_REPOS
# r8.im times out committing ~2GB+ blobs. Bake those files as 384MiB parts
# and concatenate during setup().
CHUNK_MARK = ".ashrium_part."
CHUNK_BYTES = 384 * 1024 * 1024


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def weights_root() -> Path:
    override = os.environ.get("ASHRIUM_WEIGHTS_ROOT", "").strip()
    if override:
        return Path(override)
    if Path("/opt/ashrium/pipeline.py").is_file() or Path("/weights").is_dir():
        return Path(os.environ.get("ASHRIUM_WEIGHTS_ROOT", "/weights"))
    return Path(__file__).resolve().parents[1] / "weights"


def hf_home() -> Path:
    return weights_root() / "hf"


def hub_cache() -> Path:
    return hf_home() / "hub"


def load_host_env() -> None:
    """Read `.env.local` on the host so `cog push` can bake gated weights."""
    env_path = repo_root() / ".env.local"
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if (value.startswith('"') and value.endswith('"')) or (
            value.startswith("'") and value.endswith("'")
        ):
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value


def read_hf_token() -> str:
    load_host_env()
    return (
        os.environ.get("HF_TOKEN")
        or os.environ.get("HUGGING_FACE_HUB_TOKEN")
        or os.environ.get("HUGGINGFACE_HUB_TOKEN")
        or ""
    ).strip()


def assemble_chunked_files(root: Path) -> int:
    """Concatenate `name.ashrium_part.00+` into `name` when the whole file is absent."""
    groups: dict[Path, list[Path]] = defaultdict(list)
    if not root.is_dir():
        return 0
    for path in root.rglob("*"):
        if not path.is_file() or CHUNK_MARK not in path.name:
            continue
        base_name = path.name.split(CHUNK_MARK, 1)[0]
        groups[path.with_name(base_name)].append(path)
    assembled = 0
    for dest, parts in groups.items():
        ordered = sorted(parts, key=lambda item: item.name)
        expected = sum(part.stat().st_size for part in ordered)
        if dest.is_file() and dest.stat().st_size == expected:
            continue
        tmp = dest.with_name(dest.name + ".assembling")
        with tmp.open("wb") as out:
            for part in ordered:
                with part.open("rb") as inp:
                    shutil.copyfileobj(inp, out, 8 * 1024 * 1024)
        tmp.replace(dest)
        assembled += 1
    return assembled


def configure_hf_cache() -> Path:
    """Point huggingface_hub / SAM 2 / MoGe at the baked cache."""
    home = hf_home()
    hub = hub_cache()
    home.mkdir(parents=True, exist_ok=True)
    hub.mkdir(parents=True, exist_ok=True)
    assemble_chunked_files(hub)
    os.environ["HF_HOME"] = str(home)
    os.environ["HF_HUB_CACHE"] = str(hub)
    os.environ["HUGGINGFACE_HUB_CACHE"] = str(hub)
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    token = read_hf_token()
    if token:
        os.environ.setdefault("HF_TOKEN", token)
        os.environ.setdefault("HUGGING_FACE_HUB_TOKEN", token)
    return hub


def _hub_model_dir(repo_id: str) -> Path:
    return hub_cache() / f"models--{repo_id.replace('/', '--')}"


def snapshot_dir_for(repo_id: str) -> Path | None:
    snapshots = _hub_model_dir(repo_id) / "snapshots"
    if not snapshots.is_dir():
        return None
    candidates = sorted(snapshots.iterdir(), key=lambda path: path.stat().st_mtime, reverse=True)
    for snap in candidates:
        if snap.is_dir() and any(snap.iterdir()):
            return snap
    return None


def sam3d_snapshot_ready() -> bool:
    snap = snapshot_dir_for(SAM3D_HF_REPO)
    if snap is None:
        return False
    return (snap / "model.ckpt").is_file() and (snap / "assets" / "mhr_model.pt").is_file()


def public_snapshots_ready() -> bool:
    return all(snapshot_dir_for(repo) is not None for repo in PUBLIC_HF_REPOS)


def _download_repo(repo_id: str, token: str | None) -> Path:
    from huggingface_hub import snapshot_download

    configure_hf_cache()
    print(f"Prefetching {repo_id} into {hub_cache()}", flush=True)
    local = snapshot_download(
        repo_id=repo_id,
        cache_dir=str(hub_cache()),
        token=token or None,
    )
    return Path(local)


def prefetch(*, include_gated: bool = True) -> None:
    """Download checkpoints into cog/weights/hf. Safe to re-run."""
    configure_hf_cache()
    token = read_hf_token()
    for repo_id in PUBLIC_HF_REPOS:
        _download_repo(repo_id, token)
    if not include_gated:
        return
    if not token:
        raise SystemExit(
            "HF_TOKEN is required to bake gated facebook/sam-3d-body-dinov3. "
            "Add it to .env.local (do not paste it into chat), then re-run "
            "python -m body.prefetch_weights."
        )
    _download_repo(SAM3D_HF_REPO, token)
    if not sam3d_snapshot_ready():
        raise SystemExit(
            "SAM 3D Body snapshot is incomplete after download "
            f"(missing model.ckpt or assets/mhr_model.pt under {hub_cache()})."
        )


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    include_gated = "--public-only" not in args
    try:
        prefetch(include_gated=include_gated)
    except SystemExit as error:
        print(error, file=sys.stderr, flush=True)
        return 1
    print(
        "Baked snapshots: "
        + ", ".join(
            f"{repo}={'yes' if snapshot_dir_for(repo) else 'no'}"
            for repo in BAKED_HF_REPOS
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
