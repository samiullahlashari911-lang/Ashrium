/**
 * Shading inputs that make a draped garment read as cloth in the shopper's
 * photo: normals smoothed across the sewn seams (the solver's panels arrive
 * split there) and a per-vertex occlusion that darkens the inside of folds.
 * Pure geometry on the drape the GPU produced; no images involved.
 */

const WELD_KEY_SCALE = 1e5; // 0.01 mm: seam vertices share a position exactly

function weldIds(positions: ArrayLike<number>, count: number): Uint32Array {
  const ids = new Uint32Array(count);
  const seen = new Map<string, number>();
  for (let i = 0; i < count; i += 1) {
    const key = `${Math.round(positions[i * 3] * WELD_KEY_SCALE)},${Math.round(positions[i * 3 + 1] * WELD_KEY_SCALE)},${Math.round(positions[i * 3 + 2] * WELD_KEY_SCALE)}`;
    const id = seen.get(key);
    if (id === undefined) {
      seen.set(key, i);
      ids[i] = i;
    } else {
      ids[i] = id;
    }
  }
  return ids;
}

/** Area-weighted vertex normals, shared by every vertex at the same position. */
export function seamSmoothNormals(positions: ArrayLike<number>, indices: ArrayLike<number>): Float32Array {
  const count = positions.length / 3;
  const ids = weldIds(positions, count);
  const sums = new Float64Array(count * 3);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    const abx = positions[b * 3] - positions[a * 3];
    const aby = positions[b * 3 + 1] - positions[a * 3 + 1];
    const abz = positions[b * 3 + 2] - positions[a * 3 + 2];
    const acx = positions[c * 3] - positions[a * 3];
    const acy = positions[c * 3 + 1] - positions[a * 3 + 1];
    const acz = positions[c * 3 + 2] - positions[a * 3 + 2];
    // Cross product length = 2 x area: larger faces weigh more.
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const v of [a, b, c]) {
      const id = ids[v];
      sums[id * 3] += nx;
      sums[id * 3 + 1] += ny;
      sums[id * 3 + 2] += nz;
    }
  }
  const normals = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const id = ids[i];
    const x = sums[id * 3];
    const y = sums[id * 3 + 1];
    const z = sums[id * 3 + 2];
    const length = Math.hypot(x, y, z) || 1;
    normals[i * 3] = x / length;
    normals[i * 3 + 1] = y / length;
    normals[i * 3 + 2] = z / length;
  }
  return normals;
}

/**
 * 1 = open cloth, down to `floor` deep inside a fold. A vertex whose
 * neighbours rise in front of it (along its normal) sits in a crease; the
 * score is spread over a few rings so a fold darkens as a band, not a line.
 */
export function foldOcclusion(
  positions: ArrayLike<number>,
  normals: ArrayLike<number>,
  indices: ArrayLike<number>,
  options: { strength?: number; floor?: number; spread?: number } = {},
): Float32Array {
  const strength = options.strength ?? 2.4;
  const floor = options.floor ?? 0.55;
  const spread = options.spread ?? 4;
  const count = positions.length / 3;
  const ids = weldIds(positions, count);
  const neighbours: Array<Set<number>> = Array.from({ length: count }, () => new Set<number>());
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [ids[indices[t]], ids[indices[t + 1]], ids[indices[t + 2]]];
    for (let k = 0; k < 3; k += 1) {
      neighbours[tri[k]].add(tri[(k + 1) % 3]);
      neighbours[tri[k]].add(tri[(k + 2) % 3]);
    }
  }

  let cavity = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    if (ids[i] !== i || neighbours[i].size === 0) {
      continue;
    }
    let score = 0;
    for (const j of neighbours[i]) {
      const dx = positions[j * 3] - positions[i * 3];
      const dy = positions[j * 3 + 1] - positions[i * 3 + 1];
      const dz = positions[j * 3 + 2] - positions[i * 3 + 2];
      const length = Math.hypot(dx, dy, dz) || 1;
      score += (dx * normals[i * 3] + dy * normals[i * 3 + 1] + dz * normals[i * 3 + 2]) / length;
    }
    cavity[i] = Math.max(0, score / neighbours[i].size);
  }
  for (let pass = 0; pass < spread; pass += 1) {
    const next = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      if (ids[i] !== i) {
        continue;
      }
      let sum = cavity[i];
      for (const j of neighbours[i]) {
        sum += cavity[j];
      }
      next[i] = sum / (neighbours[i].size + 1);
    }
    cavity = next;
  }

  const occlusion = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    occlusion[i] = Math.max(floor, 1 - strength * cavity[ids[i]]);
  }
  return occlusion;
}

/**
 * Where the drape is compressed against its own sewing pattern, and along which
 * direction. The solver's cloth is a 1.4 cm mesh: real jersey buckles into
 * 1-4 cm wrinkles that it cannot show, but it does report the excess length
 * (the smaller principal stretch of each triangle, pattern → drape, below 1).
 * The shader draws wrinkles there, across that direction, as strongly as the
 * compression: physics below the mesh, never decoration. `uv` is each
 * vertex's pattern position in metres.
 */
export interface ClothCompression {
  /** 0 (relaxed or stretched) to 1 (strongly compressed), per vertex. */
  amount: Float32Array;
  /** Unit compression direction per vertex (3 each, drape frame); 0 where relaxed. */
  direction: Float32Array;
}

/** Principal stretch at or above this is relaxed; at or below the floor it is fully compressed. */
const COMPRESSION_START = 0.99;
const COMPRESSION_FULL = 0.9;
/** Stretches outside this range come from triangles whose pattern coordinates jump across a seam. */
const VALID_STRETCH_MIN = 0.5;
const VALID_STRETCH_MAX = 2;

export function clothCompression(
  positions: ArrayLike<number>,
  uv: ArrayLike<number>,
  indices: ArrayLike<number>,
): ClothCompression {
  const count = positions.length / 3;
  const amount = new Float32Array(count);
  const direction = new Float32Array(count * 3);
  const weight = new Float32Array(count);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    const e1 = [positions[b * 3] - positions[a * 3], positions[b * 3 + 1] - positions[a * 3 + 1], positions[b * 3 + 2] - positions[a * 3 + 2]];
    const e2 = [positions[c * 3] - positions[a * 3], positions[c * 3 + 1] - positions[a * 3 + 1], positions[c * 3 + 2] - positions[a * 3 + 2]];
    const u1 = [uv[b * 2] - uv[a * 2], uv[b * 2 + 1] - uv[a * 2 + 1]];
    const u2 = [uv[c * 2] - uv[a * 2], uv[c * 2 + 1] - uv[a * 2 + 1]];
    const det = u1[0] * u2[1] - u2[0] * u1[1];
    if (Math.abs(det) < 1e-12) {
      continue;
    }
    // Deformation gradient F (3x2): pattern → drape.
    const i00 = u2[1] / det;
    const i01 = -u2[0] / det;
    const i10 = -u1[1] / det;
    const i11 = u1[0] / det;
    const f0 = [0, 1, 2].map((r) => e1[r] * i00 + e2[r] * i10);
    const f1 = [0, 1, 2].map((r) => e1[r] * i01 + e2[r] * i11);
    // Right Cauchy-Green C = FᵀF; its smaller eigenvalue is the squared compressed stretch.
    const c00 = f0[0] * f0[0] + f0[1] * f0[1] + f0[2] * f0[2];
    const c01 = f0[0] * f1[0] + f0[1] * f1[1] + f0[2] * f1[2];
    const c11 = f1[0] * f1[0] + f1[1] * f1[1] + f1[2] * f1[2];
    const half = (c00 + c11) / 2;
    const root = Math.sqrt(Math.max(0, half * half - (c00 * c11 - c01 * c01)));
    const small = half - root;
    const stretch = Math.sqrt(Math.max(0, small));
    if (stretch < VALID_STRETCH_MIN || stretch > VALID_STRETCH_MAX || stretch >= COMPRESSION_START) {
      continue;
    }
    // Its eigenvector in pattern space, carried into the drape by F.
    const v = Math.abs(c01) > 1e-12 ? [c01, small - c00] : c00 <= c11 ? [1, 0] : [0, 1];
    const d = [0, 1, 2].map((r) => f0[r] * v[0] + f1[r] * v[1]);
    const length = Math.hypot(d[0], d[1], d[2]) || 1;
    const strength = Math.min(1, (COMPRESSION_START - stretch) / (COMPRESSION_START - COMPRESSION_FULL));
    for (const vertex of [a, b, c]) {
      // Directions have no sign: align with what the vertex has gathered so far.
      const dot = direction[vertex * 3] * d[0] + direction[vertex * 3 + 1] * d[1] + direction[vertex * 3 + 2] * d[2];
      const sign = dot < 0 ? -1 : 1;
      for (let k = 0; k < 3; k += 1) {
        direction[vertex * 3 + k] += (sign * strength * d[k]) / length;
      }
      amount[vertex] += strength;
      weight[vertex] += 1;
    }
  }
  for (let i = 0; i < count; i += 1) {
    if (weight[i] > 0) {
      amount[i] = Math.min(1, amount[i] / weight[i]);
      const length = Math.hypot(direction[i * 3], direction[i * 3 + 1], direction[i * 3 + 2]) || 1;
      for (let k = 0; k < 3; k += 1) {
        direction[i * 3 + k] /= length;
      }
    }
  }
  return { amount, direction };
}

/**
 * 1 on the garment's open edges (hem, sleeve ends, neckline), 0.4 one ring in,
 * 0 elsewhere. Seams are not edges: vertices at the same position are one.
 */
export function openEdgeRim(positions: ArrayLike<number>, indices: ArrayLike<number>): Float32Array {
  const count = positions.length / 3;
  const ids = weldIds(positions, count);
  const uses = new Map<number, number>();
  const key = (p: number, q: number): number => (p < q ? p * count + q : q * count + p);
  for (let t = 0; t < indices.length; t += 3) {
    const corners = [indices[t], indices[t + 1], indices[t + 2]];
    for (let k = 0; k < 3; k += 1) {
      const edgeKey = key(ids[corners[k]], ids[corners[(k + 1) % 3]]);
      uses.set(edgeKey, (uses.get(edgeKey) ?? 0) + 1);
    }
  }
  const edge = new Uint8Array(count);
  for (const [edgeKey, n] of uses) {
    if (n === 1) {
      edge[Math.floor(edgeKey / count)] = 1;
      edge[edgeKey % count] = 1;
    }
  }
  const rim = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    rim[i] = edge[ids[i]] ? 1 : 0;
  }
  for (let t = 0; t < indices.length; t += 3) {
    const corners = [indices[t], indices[t + 1], indices[t + 2]];
    if (corners.some((vertex) => edge[ids[vertex]])) {
      for (const vertex of corners) {
        if (!edge[ids[vertex]]) {
          rim[vertex] = Math.max(rim[vertex], 0.4);
        }
      }
    }
  }
  return rim;
}
