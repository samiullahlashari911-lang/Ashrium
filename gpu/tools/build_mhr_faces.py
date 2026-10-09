"""Offline: MHR LOD 1 triangle indices from public/models/mhr-hull.glb.

Writes gpu/body/mhr_lod1_faces.npy (uint16, (F, 3)) so task=body can compute
per-view normals and visibility without the browser sending its mesh. The
glb is the same `mhr-18439-127` vertex order the client deforms. No biometrics.

    python gpu/tools/build_mhr_faces.py
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
GLB = REPO / "public" / "models" / "mhr-hull.glb"
OUT = REPO / "gpu" / "body" / "mhr_lod1_faces.npy"
VERTEX_COUNT = 18439
COMPONENT_DTYPES = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32}


def read_glb_indices(path: Path) -> np.ndarray:
    data = path.read_bytes()
    magic, _version, _length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF":
        raise RuntimeError(f"{path} is not a binary glTF.")
    json_length, json_type = struct.unpack_from("<I4s", data, 12)
    if json_type != b"JSON":
        raise RuntimeError("First glb chunk must be JSON.")
    gltf = json.loads(data[20 : 20 + json_length])
    bin_start = 20 + json_length + 8
    primitive = gltf["meshes"][0]["primitives"][0]
    if primitive.get("mode", 4) != 4:
        raise RuntimeError("MHR hull must be a triangle list.")
    if gltf["accessors"][primitive["attributes"]["POSITION"]]["count"] != VERTEX_COUNT:
        raise RuntimeError(f"MHR hull must have {VERTEX_COUNT} vertices.")
    accessor = gltf["accessors"][primitive["indices"]]
    view = gltf["bufferViews"][accessor["bufferView"]]
    offset = bin_start + view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    dtype = COMPONENT_DTYPES[accessor["componentType"]]
    indices = np.frombuffer(data, dtype=dtype, count=accessor["count"], offset=offset)
    return indices.reshape(-1, 3)


def main() -> None:
    faces = read_glb_indices(GLB)
    if int(faces.max()) >= VERTEX_COUNT:
        raise RuntimeError("Face index out of range.")
    np.save(OUT, faces.astype(np.uint16))
    print(f"wrote {OUT.relative_to(REPO)}: {faces.shape[0]} triangles")


if __name__ == "__main__":
    main()
