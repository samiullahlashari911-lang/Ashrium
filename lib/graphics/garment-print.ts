import { BODY_PART } from '@/lib/graphics/body-parts';
import type { GarmentCategory } from '@/types/garment';

/**
 * Where the product photo goes on the draped garment (lib/graphics/garment-look.ts):
 * the photo's front onto the drape's front torso, row by row from collar (or
 * waistband) to hem and side to side, and which vertices sit on a seam.
 */

export interface DrapeLookAttributes {
  /** Per vertex: (u, v) in the product photo's front map. */
  printUv: Float32Array;
  /** Per vertex: 0-1, how much the photo's front shows here (front torso only, fading at the sides). */
  printWeight: Float32Array;
  /** Per vertex: 1 where the vertex sits on a seam between pattern pieces. */
  seam: Float32Array;
}

/** A pattern-space edge this much longer than in 3D crosses from one sewn piece to another. */
const SEAM_STRETCH = 2.5;
/** Front facing: the body's normal points this much toward the camera (fades in up to FRONT_FULL). */
const FRONT_START = 0.2;
const FRONT_FULL = 0.45;
const CELL_M = 0.03;
const HEIGHT_BINS = 48;

const TOPS: ReadonlySet<GarmentCategory> = new Set(['tee', 'outerwear', 'dress'] as GarmentCategory[]);

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Vertices on a seam: their triangles' pattern edges jump between pieces. */
export function seamVertices(positions: Float32Array, uv: Float32Array, indices: Uint32Array, vertexCount: number): Float32Array {
  const seam = new Float32Array(vertexCount);
  for (let t = 0; t < indices.length; t += 3) {
    let stretch = 0;
    for (let e = 0; e < 3; e += 1) {
      const a = indices[t + e];
      const b = indices[t + ((e + 1) % 3)];
      const flat = Math.hypot(uv[a * 2] - uv[b * 2], uv[a * 2 + 1] - uv[b * 2 + 1]);
      const real = Math.hypot(
        positions[a * 3] - positions[b * 3],
        positions[a * 3 + 1] - positions[b * 3 + 1],
        positions[a * 3 + 2] - positions[b * 3 + 2],
      );
      stretch = Math.max(stretch, flat / Math.max(real, 1e-4));
    }
    if (stretch > SEAM_STRETCH) {
      seam[indices[t]] = 1;
      seam[indices[t + 1]] = 1;
      seam[indices[t + 2]] = 1;
    }
  }
  return seam;
}

/** Nearest body vertex per garment vertex (spatial grid, ~3 cm cells), -1 when none is near. */
function nearestBodyVertex(garment: Float32Array, body: Float32Array): Int32Array {
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number, z: number): string => `${Math.floor(x / CELL_M)},${Math.floor(y / CELL_M)},${Math.floor(z / CELL_M)}`;
  for (let i = 0; i < body.length / 3; i += 1) {
    const k = key(body[i * 3], body[i * 3 + 1], body[i * 3 + 2]);
    const bucket = grid.get(k);
    if (bucket) {
      bucket.push(i);
    } else {
      grid.set(k, [i]);
    }
  }
  const count = garment.length / 3;
  const out = new Int32Array(count).fill(-1);
  for (let i = 0; i < count; i += 1) {
    const x = garment[i * 3];
    const y = garment[i * 3 + 1];
    const z = garment[i * 3 + 2];
    const cx = Math.floor(x / CELL_M);
    const cy = Math.floor(y / CELL_M);
    const cz = Math.floor(z / CELL_M);
    let best = -1;
    let bestDistance = Infinity;
    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dz = -2; dz <= 2; dz += 1) {
          for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            const d = (body[j * 3] - x) ** 2 + (body[j * 3 + 1] - y) ** 2 + (body[j * 3 + 2] - z) ** 2;
            if (d < bestDistance) {
              bestDistance = d;
              best = j;
            }
          }
        }
      }
    }
    out[i] = best;
  }
  return out;
}

/** The nearest non-empty row of a front map, or -1. */
function rowSpan(rows: Int32Array, row: number): [number, number] | null {
  const count = rows.length / 2;
  for (let offset = 0; offset < count; offset += 1) {
    for (const r of [row - offset, row + offset]) {
      if (r >= 0 && r < count && rows[r * 2] >= 0) {
        return [rows[r * 2], rows[r * 2 + 1]];
      }
    }
  }
  return null;
}

export function drapeLookAttributes(options: {
  /** Draped garment, canonical metres (y up, front toward +z). */
  draped: Float32Array;
  uv: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  bodyPositions: Float32Array;
  bodyNormals: Float32Array;
  bodyParts: Uint8Array | null;
  category: GarmentCategory | null;
  /** The product photo's front map rows (garment-look.ts), null when its front is not usable. */
  frontRows: Int32Array | null;
  frontWidth: number;
  frontHeight: number;
}): DrapeLookAttributes {
  const { draped, uv, indices, vertexCount, bodyPositions, bodyNormals, bodyParts, category, frontRows, frontWidth, frontHeight } = options;
  const seam = seamVertices(draped, uv, indices, vertexCount);
  const printUv = new Float32Array(vertexCount * 2);
  const printWeight = new Float32Array(vertexCount);
  if (!frontRows || frontWidth <= 0 || frontHeight <= 0) {
    return { printUv, printWeight, seam };
  }

  // Front torso (or front legs for a bottom): the body underneath faces the camera.
  const isTop = category === null || TOPS.has(category);
  const nearest = nearestBodyVertex(draped, bodyPositions);
  for (let i = 0; i < vertexCount; i += 1) {
    const j = nearest[i];
    if (j < 0) {
      continue;
    }
    const part = bodyParts?.[j];
    const torso = part === undefined
      || (isTop ? part === BODY_PART.upperTorso || part === BODY_PART.lowerTorsoLegs : part === BODY_PART.lowerTorsoLegs);
    if (torso) {
      printWeight[i] = smoothstep(FRONT_START, FRONT_FULL, bodyNormals[j * 3 + 2]);
    }
  }

  // The front's height span and, per height, its side-to-side span.
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let i = 0; i < vertexCount; i += 1) {
    if (printWeight[i] > 0) {
      yMin = Math.min(yMin, draped[i * 3 + 1]);
      yMax = Math.max(yMax, draped[i * 3 + 1]);
    }
  }
  if (!(yMax > yMin)) {
    printWeight.fill(0);
    return { printUv, printWeight, seam };
  }
  const binOf = (y: number): number => Math.min(HEIGHT_BINS - 1, Math.max(0, Math.floor(((yMax - y) / (yMax - yMin)) * HEIGHT_BINS)));
  const binMin = new Float32Array(HEIGHT_BINS).fill(Infinity);
  const binMax = new Float32Array(HEIGHT_BINS).fill(-Infinity);
  for (let i = 0; i < vertexCount; i += 1) {
    if (printWeight[i] > 0) {
      const b = binOf(draped[i * 3 + 1]);
      binMin[b] = Math.min(binMin[b], draped[i * 3]);
      binMax[b] = Math.max(binMax[b], draped[i * 3]);
    }
  }

  // Folds make each height's extent jagged: smooth it over neighbouring heights.
  const smoothMin = new Float32Array(HEIGHT_BINS);
  const smoothMax = new Float32Array(HEIGHT_BINS);
  for (let k = 0; k < HEIGHT_BINS; k += 1) {
    let low = 0;
    let high = 0;
    let count = 0;
    for (let j = Math.max(0, k - 2); j <= Math.min(HEIGHT_BINS - 1, k + 2); j += 1) {
      if (binMax[j] > binMin[j]) {
        low += binMin[j];
        high += binMax[j];
        count += 1;
      }
    }
    smoothMin[k] = count > 0 ? low / count : Infinity;
    smoothMax[k] = count > 0 ? high / count : -Infinity;
  }
  binMin.set(smoothMin);
  binMax.set(smoothMax);

  for (let i = 0; i < vertexCount; i += 1) {
    if (printWeight[i] <= 0) {
      continue;
    }
    const y = draped[i * 3 + 1];
    const row = Math.round(((yMax - y) / (yMax - yMin)) * (frontHeight - 1));
    const span = rowSpan(frontRows, row);
    const b = binOf(y);
    if (!span || !(binMax[b] > binMin[b])) {
      printWeight[i] = 0;
      continue;
    }
    const t = Math.min(1, Math.max(0, (draped[i * 3] - binMin[b]) / (binMax[b] - binMin[b])));
    const px = span[0] + t * (span[1] - span[0]);
    printUv[i * 2] = (px + 0.5) / frontWidth;
    printUv[i * 2 + 1] = (row + 0.5) / frontHeight;
  }
  return { printUv, printWeight, seam };
}
