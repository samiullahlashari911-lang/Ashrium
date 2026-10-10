/**
 * Carry points draped on the canonical MHR body into the shopper's own photo.
 *
 * The GPU returns, per body vertex, where it lands in each uploaded photo
 * (`photo_uv`, geometry only). The body in the photo is posed (arms raised on
 * the side view) while the drape is on the canonical body, so one camera
 * cannot map it. Each body vertex gets its own small affine camera instead,
 * fitted from its neighbours' canonical positions → photo pixels; a garment
 * point uses the camera of its nearest body vertex. Patches follow the pose,
 * so a sleeve draped on the canonical arm lands on the photographed arm.
 * All on-device; nothing here leaves the browser.
 */

import { headlessUvToFrameUv, type HeadlessKeepBox } from '@/lib/widget/webp-encode';

/** Spatial hash cell (metres) for the nearest-vertex search. */
const CELL_M = 0.04;
/** Neighbours per patch camera: enough to fit 3D → 2D affinely, local enough to follow the pose. */
const PATCH_NEIGHBOURS = 64;

export type MirrorView = 'front' | 'side';

/** Body vertex positions in frame pixels (x right, y down) from the GPU's photo_uv for one view. */
export function bodyFramePixels(
  photoUv: ArrayLike<number>,
  keepBox: HeadlessKeepBox,
  frameWidth: number,
  frameHeight: number,
): Float32Array {
  const count = photoUv.length / 2;
  const pixels = new Float32Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    const [u, v] = headlessUvToFrameUv(photoUv[i * 2], photoUv[i * 2 + 1], keepBox, frameWidth, frameHeight);
    pixels[i * 2] = u * frameWidth;
    pixels[i * 2 + 1] = v * frameHeight;
  }
  return pixels;
}

/** Solve a 4x4 system (Gaussian elimination with partial pivoting). */
function solve4(matrix: number[][], rhs: number[]): number[] {
  const m = matrix.map((row, i) => [...row, rhs[i]]);
  for (let column = 0; column < 4; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 4; row += 1) {
      if (Math.abs(m[row][column]) > Math.abs(m[pivot][column])) {
        pivot = row;
      }
    }
    [m[column], m[pivot]] = [m[pivot], m[column]];
    const diagonal = m[column][column] || 1e-9;
    for (let row = 0; row < 4; row += 1) {
      if (row === column) {
        continue;
      }
      const factor = m[row][column] / diagonal;
      for (let k = column; k < 5; k += 1) {
        m[row][k] -= factor * m[column][k];
      }
    }
  }
  return m.map((row, i) => row[4] / (row[i] || 1e-9));
}

export interface PatchProjector {
  /** Canonical-body point (metres) → frame pixels [x, y]. */
  project(x: number, y: number, z: number): [number, number];
}

/**
 * `bodyPositions`: canonical LOD 1 body (metres, xyz per vertex).
 * `bodyPixels`: the same vertices in frame pixels (`bodyFramePixels`).
 * `bodyParts` (optional, one label per vertex): a patch only uses neighbours of
 * its own part, so a torso patch is not bent by the arm hanging next to it.
 */
export function createPatchProjector(
  bodyPositions: Float32Array,
  bodyPixels: Float32Array,
  bodyParts?: Uint8Array | null,
): PatchProjector {
  const count = bodyPositions.length / 3;
  const grid = new Map<string, number[]>();
  const keyOf = (cx: number, cy: number, cz: number): string => `${cx},${cy},${cz}`;
  for (let i = 0; i < count; i += 1) {
    const key = keyOf(
      Math.floor(bodyPositions[i * 3] / CELL_M),
      Math.floor(bodyPositions[i * 3 + 1] / CELL_M),
      Math.floor(bodyPositions[i * 3 + 2] / CELL_M),
    );
    const bucket = grid.get(key);
    if (bucket) {
      bucket.push(i);
    } else {
      grid.set(key, [i]);
    }
  }

  const neighbours = (x: number, y: number, z: number, reach: number): number[] => {
    const out: number[] = [];
    const cx = Math.floor(x / CELL_M);
    const cy = Math.floor(y / CELL_M);
    const cz = Math.floor(z / CELL_M);
    for (let dx = -reach; dx <= reach; dx += 1) {
      for (let dy = -reach; dy <= reach; dy += 1) {
        for (let dz = -reach; dz <= reach; dz += 1) {
          const bucket = grid.get(keyOf(cx + dx, cy + dy, cz + dz));
          if (bucket) {
            out.push(...bucket);
          }
        }
      }
    }
    return out;
  };

  const distanceSq = (i: number, x: number, y: number, z: number): number =>
    (bodyPositions[i * 3] - x) ** 2 + (bodyPositions[i * 3 + 1] - y) ** 2 + (bodyPositions[i * 3 + 2] - z) ** 2;

  const cameras = new Map<number, { mu: number[]; mv: number[] }>();
  const cameraFor = (vertex: number): { mu: number[]; mv: number[] } => {
    const cached = cameras.get(vertex);
    if (cached) {
      return cached;
    }
    const bx = bodyPositions[vertex * 3];
    const by = bodyPositions[vertex * 3 + 1];
    const bz = bodyPositions[vertex * 3 + 2];
    const part = bodyParts?.[vertex];
    const near = neighbours(bx, by, bz, 1)
      .filter((j) => !bodyParts || bodyParts[j] === part)
      .map((j) => [j, distanceSq(j, bx, by, bz)] as const)
      .sort((a, b) => a[1] - b[1])
      .slice(0, PATCH_NEIGHBOURS)
      .map(([j]) => j);
    const ata = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    const atu = [0, 0, 0, 0];
    const atv = [0, 0, 0, 0];
    for (const j of near) {
      const a = [bodyPositions[j * 3] - bx, bodyPositions[j * 3 + 1] - by, bodyPositions[j * 3 + 2] - bz, 1];
      for (let r = 0; r < 4; r += 1) {
        for (let c = 0; c < 4; c += 1) {
          ata[r][c] += a[r] * a[c];
        }
        atu[r] += a[r] * bodyPixels[j * 2];
        atv[r] += a[r] * bodyPixels[j * 2 + 1];
      }
    }
    // A patch is nearly flat: keep its normal direction solvable.
    for (let r = 0; r < 3; r += 1) {
      ata[r][r] += 1e-6;
    }
    const camera = { mu: solve4(ata, atu), mv: solve4(ata, atv) };
    cameras.set(vertex, camera);
    return camera;
  };

  const nearest = (x: number, y: number, z: number): number => {
    for (let reach = 1; reach <= 3; reach += 1) {
      let best = -1;
      let bestDistance = Infinity;
      for (const j of neighbours(x, y, z, reach)) {
        const d = distanceSq(j, x, y, z);
        if (d < bestDistance) {
          bestDistance = d;
          best = j;
        }
      }
      if (best >= 0) {
        return best;
      }
    }
    let best = 0;
    let bestDistance = Infinity;
    for (let j = 0; j < count; j += 1) {
      const d = distanceSq(j, x, y, z);
      if (d < bestDistance) {
        bestDistance = d;
        best = j;
      }
    }
    return best;
  };

  return {
    project(x: number, y: number, z: number): [number, number] {
      const vertex = nearest(x, y, z);
      const camera = cameraFor(vertex);
      const offset = [
        x - bodyPositions[vertex * 3],
        y - bodyPositions[vertex * 3 + 1],
        z - bodyPositions[vertex * 3 + 2],
        1,
      ];
      let u = 0;
      let v = 0;
      for (let i = 0; i < 4; i += 1) {
        u += camera.mu[i] * offset[i];
        v += camera.mv[i] * offset[i];
      }
      return [u, v];
    },
  };
}

/**
 * Which side of the canonical body faced the camera in the side photo: +1 when
 * the +x side did. Shoppers turn either way; the GPU's per-vertex visibility
 * for that view (0-255) says which flank it saw.
 */
export function sideCameraSign(bodyPositions: Float32Array, sideWeight: ArrayLike<number>): 1 | -1 {
  let plus = 0;
  let minus = 0;
  for (let i = 0; i < sideWeight.length; i += 1) {
    if (bodyPositions[i * 3] > 0) {
      plus += sideWeight[i];
    } else {
      minus += sideWeight[i];
    }
  }
  return plus >= minus ? 1 : -1;
}

/** Depth toward the camera on the canonical pose (+z faces the front camera). */
export function viewDepth(view: MirrorView, sideSign: 1 | -1, x: number, z: number): number {
  return view === 'front' ? z : sideSign * x;
}
