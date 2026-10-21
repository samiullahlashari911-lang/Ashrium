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

/**
 * The garment's overall form without its folds: its normals averaged over
 * neighbours `rounds` times (seams welded). The shader lights the garment by
 * the photo's own light along this form and adds the simulated folds as the
 * difference between the true normal and this one, so the folds the solver
 * made stay visible under the photo's light instead of washing out.
 */
export function formNormals(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  normals: ArrayLike<number>,
  rounds = 12,
): Float32Array {
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
  let current = Float32Array.from(normals);
  for (let round = 0; round < rounds; round += 1) {
    const next = new Float32Array(current.length);
    for (let i = 0; i < count; i += 1) {
      if (ids[i] !== i) {
        continue;
      }
      let x = current[i * 3];
      let y = current[i * 3 + 1];
      let z = current[i * 3 + 2];
      for (const j of neighbours[i]) {
        x += current[j * 3];
        y += current[j * 3 + 1];
        z += current[j * 3 + 2];
      }
      const length = Math.hypot(x, y, z) || 1;
      next[i * 3] = x / length;
      next[i * 3 + 1] = y / length;
      next[i * 3 + 2] = z / length;
    }
    for (let i = 0; i < count; i += 1) {
      const id = ids[i];
      if (id !== i) {
        next[i * 3] = next[id * 3];
        next[i * 3 + 1] = next[id * 3 + 1];
        next[i * 3 + 2] = next[id * 3 + 2];
      }
    }
    current = next;
  }
  return current;
}
