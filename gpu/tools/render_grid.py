"""Render drape-grid results into contact sheets (numpy z-buffer + Pillow, no GPU).

    python gpu/tools/render_grid.py tmp/drape-grid/grid.json [--out tmp/drape-grid/sheets]

One PNG per garment: a row per body, a column per size, front and side views.
Each cell is labelled with its status (ok / problem / too small / failed) and
the worst problem, so a reviewer sees at a glance what the grid measured.
"""

from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

FACES = Path(__file__).resolve().parents[1] / "body" / "mhr_lod1_faces.npy"
CELL_W, CELL_H = 150, 300
PX_PER_M = CELL_H / 2.1
LIGHT = np.array([0.35, 0.55, 0.75])
BODY_RGB = np.array([214, 206, 198])
GARMENT_RGB = np.array([72, 92, 138])
STATUS_RGB = {"ok": (40, 150, 70), "problem": (200, 60, 50), "too_small": (150, 150, 150), "failed": (200, 60, 50)}


def _decode(text: str, dtype: str) -> np.ndarray:
    return np.frombuffer(base64.b64decode(text), dtype=dtype)


def _samples(tris: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Barycentric sample points on each triangle (dense enough for ~1 px at this scale)."""
    steps = 5
    weights = [(i / steps, j / steps) for i in range(steps + 1) for j in range(steps + 1 - i)]
    a, b, c = tris[:, 0], tris[:, 1], tris[:, 2]
    points = np.concatenate([a + (b - a) * u + (c - a) * v for u, v in weights])
    normals = np.cross(b - a, c - a)
    normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)
    return points, np.tile(normals, (len(weights), 1))


def render(meshes: list[tuple[np.ndarray, np.ndarray, np.ndarray]], view: str, centre: np.ndarray) -> Image.Image:
    """meshes: (positions m, triangles, rgb). Orthographic front (+z camera) or side (+x camera)."""
    image = np.full((CELL_H, CELL_W, 3), 250, dtype=np.uint8)
    depth = np.full((CELL_H, CELL_W), -np.inf)
    for positions, triangles, rgb in meshes:
        if len(triangles) == 0:
            continue
        points, normals = _samples((positions - centre)[triangles])
        if view == "front":
            u, v, d, n = points[:, 0], points[:, 1], points[:, 2], normals
        else:
            u, v, d = -points[:, 2], points[:, 1], points[:, 0]
            n = normals[:, [2, 1, 0]] * np.array([-1.0, 1.0, 1.0])
        px = np.round(CELL_W / 2 + u * PX_PER_M).astype(np.int64)
        py = np.round(CELL_H * 0.52 - v * PX_PER_M).astype(np.int64)
        keep = (px >= 0) & (px < CELL_W) & (py >= 0) & (py < CELL_H)
        px, py, d = px[keep], py[keep], d[keep]
        if px.size == 0:
            continue
        shade = 0.35 + 0.65 * np.abs(n[keep] @ LIGHT)
        order = np.lexsort((-d, py * CELL_W + px))
        flat = (py * CELL_W + px)[order]
        first = np.concatenate([[True], flat[1:] != flat[:-1]])
        idx, dd, ss = flat[first], d[order][first], shade[order][first]
        nearer = dd > depth.reshape(-1)[idx]
        idx, dd, ss = idx[nearer], dd[nearer], ss[nearer]
        depth.reshape(-1)[idx] = dd
        image.reshape(-1, 3)[idx] = np.clip(rgb[None, :] * ss[:, None], 0, 255).astype(np.uint8)
    return Image.fromarray(image)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("grid")
    parser.add_argument("--out", default=None)
    args = parser.parse_args()
    report = json.loads(Path(args.grid).read_text(encoding="utf-8"))
    out_dir = Path(args.out or Path(args.grid).with_suffix("")).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    faces = np.load(FACES).astype(np.int64).reshape(-1, 3)

    for garment in report["garments"]:
        sizes = [entry["sizeCode"] for entry in garment["chart"]]
        bodies = [body for body in report["bodies"] if not body.get("error")]
        sheet = Image.new("RGB", (160 + len(sizes) * CELL_W * 2, 30 + len(bodies) * (CELL_H + 34)), "white")
        draw = ImageDraw.Draw(sheet)
        draw.text((8, 8), f"{garment['name']}  ({garment['category']})", fill=(0, 0, 0))
        for col, size in enumerate(sizes):
            draw.text((160 + col * CELL_W * 2 + CELL_W - 10, 20), size, fill=(0, 0, 0))
        for row, body in enumerate(bodies):
            top = 30 + row * (CELL_H + 34)
            body_m = _decode(body["vertices_cm"], "<f4").reshape(-1, 3).astype(np.float64) / 100.0
            centre = np.array([np.median(body_m[:, 0]), body_m[:, 1].min() + 0.5 * np.ptp(body_m[:, 1]), np.median(body_m[:, 2])])
            g = body["girths"]
            draw.text((6, top + 8), body["label"], fill=(0, 0, 0))
            draw.text((6, top + 24), f"{np.ptp(body_m[:, 1]) * 100:.0f} cm", fill=(80, 80, 80))
            draw.text((6, top + 38), f"C{g['chest_cm']:.0f} W{g['waist_cm']:.0f} H{g['hip_cm']:.0f}", fill=(80, 80, 80))
            results = {r.get("size"): r for r in body["results"] if r["garment"] == garment["key"]}
            for col, size in enumerate(sizes):
                left = 160 + col * CELL_W * 2
                result = results.get(size)
                if result is None:
                    continue
                meshes = [(body_m, faces, BODY_RGB)]
                if "positions" in result:
                    cloth = _decode(result["positions"], "<f2").reshape(-1, 3).astype(np.float64)
                    tris = _decode(result["triangles"], "<i4").reshape(-1, 3).astype(np.int64)
                    meshes.append((cloth, tris, GARMENT_RGB))
                sheet.paste(render(meshes, "front", centre), (left, top))
                sheet.paste(render(meshes, "side", centre), (left + CELL_W, top))
                status = result["status"]
                worst = result.get("reason") or next(
                    (p["code"] for p in result.get("problems", []) if p["level"] == "fail"),
                    next((p["code"] for p in result.get("problems", [])), ""),
                )
                draw.rectangle([left, top, left + 2 * CELL_W - 1, top + CELL_H - 1], outline=STATUS_RGB.get(status, (0, 0, 0)), width=2)
                draw.text((left + 4, top + CELL_H + 2), f"{status} {worst}"[:44], fill=STATUS_RGB.get(status, (0, 0, 0)))
                metrics = result.get("metrics", {})
                if metrics:
                    draw.text(
                        (left + 4, top + CELL_H + 16),
                        f"x{metrics['stretch_p99']} gap{metrics['gap_max_cm']:.0f} {result.get('ms', 0) / 1000:.1f}s",
                        fill=(90, 90, 90),
                    )
        path = out_dir / f"{garment['key']}.png"
        sheet.save(path)
        print(path)


if __name__ == "__main__":
    main()
