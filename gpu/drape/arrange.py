"""Place a sewn GarmentCode garment around the shopper's MHR body before the drape.

GarmentCode positions panels around its own mean body. The shopper's body is
taller/shorter and sits elsewhere, so the garment is moved (never scaled: the
size is the size) so its torso centres on the shopper's chest and its shoulder
line rests just above theirs; then every panel is slid out along its normal
until it clears the skin, the seams are welded, and any welded vertex still
inside the body is pushed out. Distances are exact (closest point on the
watertight LOD 1 body): a nearest-vertex sign on the simplified collider
flipped near the hands and shoved a front panel 70 cm out. Metres, Y-up.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from drape.border import nearest_vertices, signed_distance_to_mesh, vertex_faces
from pattern.sew import weld

TORSO_TOKENS = ("ftorso", "btorso", "torso", "front", "back")
CLEAR_M = 0.012
# Lateral offsets from the centre line: past the head and neck (~9 cm), on the shoulder.
SHOULDER_BAND_M = (0.12, 0.17)
SHOULDER_LIFT_M = 0.015
MAX_PUSH_M = 0.15
MAX_PUSH_STEP_M = 0.02


def body_normals(positions: np.ndarray, faces: np.ndarray) -> np.ndarray:
    tris = positions[faces.reshape(-1, 3)]
    face_normals = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    normals = np.zeros_like(positions)
    for corner in range(3):
        np.add.at(normals, faces.reshape(-1, 3)[:, corner], face_normals)
    length = np.linalg.norm(normals, axis=1, keepdims=True)
    normals = normals / np.maximum(length, 1e-12)
    centre = positions.mean(axis=0)
    if float(np.sum(np.einsum("ij,ij->i", normals, positions - centre))) < 0:
        normals = -normals
    return normals


class Body:
    """The watertight LOD 1 body with lookup tables for exact distances."""

    def __init__(self, positions: np.ndarray, faces: np.ndarray) -> None:
        self.positions = positions
        self.faces = faces.reshape(-1, 3)
        self.normals = body_normals(positions, self.faces)
        self.incident = vertex_faces(self.faces, positions.shape[0])

    def distance(self, points: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Signed distance (outside > 0) and the closest surface point."""
        return signed_distance_to_mesh(points, self.positions, self.faces, self.incident)

    def outward(self, points: np.ndarray, distance: np.ndarray, closest: np.ndarray) -> np.ndarray:
        """Unit direction from the surface out through each point."""
        offset = (points - closest) * np.sign(distance)[:, None]
        length = np.linalg.norm(offset, axis=1, keepdims=True)
        fallback = self.normals[nearest_vertices(closest, self.positions, 1)[:, 0]]
        return np.where(length > 1e-6, offset / np.maximum(length, 1e-12), fallback)


def _is_torso(name: str) -> bool:
    lowered = name.lower()
    return any(token in lowered for token in TORSO_TOKENS) and "sleeve" not in lowered


def _shoulder_top(points: np.ndarray, centre_x: float) -> float:
    lateral = np.abs(points[:, 0] - centre_x)
    band = points[(lateral >= SHOULDER_BAND_M[0]) & (lateral <= SHOULDER_BAND_M[1])]
    if band.shape[0] == 0:
        raise RuntimeError("No shoulder samples in the lateral band.")
    return float(band[:, 1].max())


def _panel_outward(panel: np.ndarray, body: Body) -> np.ndarray:
    """The flat panel's plane normal, pointing away from the body it faces."""
    centred = panel - panel.mean(axis=0)
    _u, _s, vt = np.linalg.svd(centred, full_matrices=False)
    normal = vt[2]
    distance, closest = body.distance(panel)
    facing = np.einsum("ij,j->i", body.outward(panel, distance, closest), normal)
    if float(np.median(facing)) < 0:
        normal = -normal
    return normal / max(float(np.linalg.norm(normal)), 1e-12)


def relax_flat_triangles(positions: np.ndarray, triangles: np.ndarray, min_area_m2: float = 1e-10) -> int:
    """Nudge the middle point of triangles a weld squashed flat 1 mm off the line (in place).

    Averaging stitched vertices can line up three seam points exactly; Newton's
    add_triangles drops a zero-area triangle, which breaks Style3D's edge
    bookkeeping. Averaging toward neighbours does not work there: a seam's
    neighbours sit symmetrically on both panels, so their mean is on the line.
    The solver smooths the 1 mm out in its first frame. Returns how many were flat.
    """
    def areas() -> np.ndarray:
        corners = positions[triangles]
        return 0.5 * np.linalg.norm(
            np.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0]), axis=1
        )

    flat = areas() < min_area_m2
    initially = int(flat.sum())
    for _ in range(5):
        if not flat.any():
            break
        for tri in triangles[flat]:
            corners = positions[tri]
            cosines = []
            for k in range(3):
                u = corners[(k + 1) % 3] - corners[k]
                v = corners[(k + 2) % 3] - corners[k]
                cosines.append(float(np.dot(u, v)) / max(float(np.linalg.norm(u) * np.linalg.norm(v)), 1e-18))
            middle = int(np.argmin(cosines))  # the widest angle sits between the other two
            line = corners[(middle + 2) % 3] - corners[(middle + 1) % 3]
            line /= max(float(np.linalg.norm(line)), 1e-12)
            axis = np.eye(3)[int(np.argmin(np.abs(line)))]
            off = np.cross(line, axis)
            positions[int(tri[middle])] += off / max(float(np.linalg.norm(off)), 1e-12) * 0.001
        flat = areas() < min_area_m2
    if flat.any():
        raise RuntimeError(f"{int(flat.sum())} garment triangles stay flat after the weld.")
    return initially


def solver_rest_uv(uv: np.ndarray, panel_triangles: np.ndarray, panel_of_vertex: np.ndarray) -> tuple[np.ndarray, list[int]]:
    """Pattern coordinates for the solver: every triangle with positive 2D area.

    GarmentCode winds some panels clockwise so their 3D normal faces out, and
    Newton Style3D silently drops negative-area triangles as inverted (half the
    shirt vanished). Mirroring a panel's u keeps every length and angle, so
    the rest shape is unchanged. Texture UVs stay the original pattern.
    """
    rest = uv.copy()
    corners = uv[panel_triangles]
    signed = 0.5 * (
        (corners[:, 1, 0] - corners[:, 0, 0]) * (corners[:, 2, 1] - corners[:, 0, 1])
        - (corners[:, 1, 1] - corners[:, 0, 1]) * (corners[:, 2, 0] - corners[:, 0, 0])
    )
    triangle_panel = panel_of_vertex[panel_triangles[:, 0]]
    mirrored: list[int] = []
    for panel in np.unique(triangle_panel):
        mask = triangle_panel == panel
        if bool((signed[mask] < 0).all()):
            rest[panel_of_vertex == panel, 0] *= -1.0
            mirrored.append(int(panel))
        elif not bool((signed[mask] > 0).all()):
            raise RuntimeError(f"Panel {int(panel)} has mixed triangle winding.")
    return rest, mirrored


def orient_panels(
    welded_triangles: np.ndarray,
    panel_triangles: np.ndarray,
    panel_of_triangle: np.ndarray,
    positions: np.ndarray,
    body: Body,
) -> tuple[np.ndarray, np.ndarray, list[int]]:
    """Wind every panel the same way across its seams, then outward from the body.

    Each panel is triangulated in its own 2D frame, so neighbours can come out
    with opposite winding; the solver's bending reads edges from consistently
    wound triangles.
    """
    panel_count = int(panel_of_triangle.max()) + 1
    owners: dict[tuple[int, int], list[tuple[int, bool]]] = {}
    for tri_index, (a, b, c) in enumerate(welded_triangles):
        for u, v in ((a, b), (b, c), (c, a)):
            owners.setdefault((min(u, v), max(u, v)), []).append((tri_index, bool(u < v)))
    votes: dict[tuple[int, int], int] = {}
    for pair in owners.values():
        if len(pair) != 2:
            continue
        (t0, d0), (t1, d1) = pair
        p0, p1 = int(panel_of_triangle[t0]), int(panel_of_triangle[t1])
        if p0 == p1:
            continue
        key = (min(p0, p1), max(p0, p1))
        votes[key] = votes.get(key, 0) + (1 if d0 != d1 else -1)

    flip = np.zeros(panel_count, dtype=bool)
    seen = np.zeros(panel_count, dtype=bool)
    sizes = np.bincount(panel_of_triangle, minlength=panel_count)
    for root in np.argsort(-sizes):
        if seen[root]:
            continue
        seen[root] = True
        queue = [int(root)]
        while queue:
            current = queue.pop()
            for (p0, p1), vote in votes.items():
                if current not in (p0, p1):
                    continue
                other = p1 if current == p0 else p0
                if seen[other]:
                    continue
                seen[other] = True
                flip[other] = flip[current] if vote > 0 else not flip[current]
                queue.append(other)

    tri_flip = flip[panel_of_triangle]
    welded_out = welded_triangles.copy()
    panel_out = panel_triangles.copy()
    welded_out[tri_flip] = welded_out[tri_flip][:, [0, 2, 1]]
    panel_out[tri_flip] = panel_out[tri_flip][:, [0, 2, 1]]

    corners = positions[welded_out]
    face_normals = np.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0])
    centroids = corners.mean(axis=1)
    distance, closest = body.distance(centroids)
    outward = np.einsum("ij,ij->i", face_normals, body.outward(centroids, distance, closest))
    if float(np.sum(np.sign(outward))) < 0:
        welded_out = welded_out[:, [0, 2, 1]]
        panel_out = panel_out[:, [0, 2, 1]]
    return welded_out, panel_out, [int(index) for index in np.nonzero(flip)[0]]


def arrange_on_body(
    garment: dict[str, Any],
    body_positions: np.ndarray,
    body_faces: np.ndarray,
) -> dict[str, Any]:
    """`body_positions`/`body_faces`: the watertight LOD 1 body (not the collider)."""
    body = Body(body_positions, body_faces)
    positions = np.asarray(garment["positions"], dtype=np.float64).reshape(-1, 3)
    panel_of_vertex = np.asarray(garment["panel_of_vertex"], dtype=np.int64)
    names: list[str] = list(garment["panels"])
    torso_panels = [index for index, name in enumerate(names) if _is_torso(name)]
    if not torso_panels:
        raise RuntimeError(f"No torso panels among {names}.")
    torso = np.isin(panel_of_vertex, torso_panels)

    # Shopper chest: the body band at 72% of its height (torso only, arms excluded).
    height = float(body_positions[:, 1].max() - body_positions[:, 1].min())
    chest_y = float(body_positions[:, 1].min()) + 0.72 * height
    band = body_positions[np.abs(body_positions[:, 1] - chest_y) < 0.03]
    central = band[np.abs(band[:, 0] - np.median(band[:, 0])) < 0.18]
    body_cx = float(np.median(central[:, 0]))
    body_cz = 0.5 * float(central[:, 2].min() + central[:, 2].max())

    garment_torso = positions[torso]
    garment_cx = 0.5 * float(garment_torso[:, 0].min() + garment_torso[:, 0].max())
    garment_cz = 0.5 * float(garment_torso[:, 2].min() + garment_torso[:, 2].max())
    shift = np.array([body_cx - garment_cx, 0.0, body_cz - garment_cz])
    positions = positions + shift

    near_torso = body_positions[np.abs(body_positions[:, 2] - body_cz) < 0.16]
    lift = (_shoulder_top(near_torso, body_cx) + SHOULDER_LIFT_M) - _shoulder_top(
        positions[torso], body_cx
    )
    positions[:, 1] += lift

    pushes: dict[str, float] = {}
    for panel_index, name in enumerate(names):
        mask = panel_of_vertex == panel_index
        panel = positions[mask]
        outward = _panel_outward(panel, body)
        travelled = 0.0
        while travelled < MAX_PUSH_M:
            distance, _ = body.distance(panel)
            if float(distance.min()) >= CLEAR_M:
                break
            # Small steps, capped in total: what a panel cannot clear the
            # per-vertex push after the weld handles.
            step = float(np.clip(CLEAR_M - float(distance.min()), 0.005, MAX_PUSH_STEP_M))
            panel = panel + outward * step
            travelled += step
        positions[mask] = panel
        pushes[name] = round(travelled, 4)

    welded_id = weld(garment["stitches"], positions.shape[0])
    welded_count = int(welded_id.max()) + 1
    sums = np.zeros((welded_count, 3))
    np.add.at(sums, welded_id, positions)
    welded = sums / np.bincount(welded_id, minlength=welded_count)[:, None]

    distance, closest = body.distance(welded)
    inside = distance < CLEAR_M
    direction = body.outward(welded[inside], distance[inside], closest[inside])
    welded[inside] = closest[inside] + direction * CLEAR_M

    triangles = np.asarray(garment["triangles"], dtype=np.int64).reshape(-1, 3)
    welded_triangles = welded_id[triangles]
    keep = (
        (welded_triangles[:, 0] != welded_triangles[:, 1])
        & (welded_triangles[:, 1] != welded_triangles[:, 2])
        & (welded_triangles[:, 2] != welded_triangles[:, 0])
    )
    flattened = relax_flat_triangles(welded, welded_triangles[keep])
    oriented, panel_oriented, flipped = orient_panels(
        welded_triangles[keep],
        triangles[keep],
        panel_of_vertex[triangles[keep][:, 0]],
        welded,
        body,
    )
    rest_uv, mirrored = solver_rest_uv(
        np.asarray(garment["uv"], dtype=np.float64).reshape(-1, 2), panel_oriented, panel_of_vertex
    )
    return {
        "rest_uv": rest_uv,
        "welded_positions": welded,
        "welded_triangles": oriented,
        "panel_triangles": panel_oriented,
        "welded_id": welded_id,
        "placed_positions": positions,
        "diagnostics": {
            "shift_m": [round(float(v), 4) for v in shift],
            "shoulder_lift_m": round(float(lift), 4),
            "panel_push_m": pushes,
            "pushed_after_weld": int(inside.sum()),
            "welded_vertex_count": welded_count,
            "dropped_triangles": int((~keep).sum()),
            "flipped_panels": [names[index] for index in flipped],
            "relaxed_flat_triangles": flattened,
            "mirrored_rest_panels": [names[index] for index in mirrored],
        },
    }
