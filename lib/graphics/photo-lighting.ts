/**
 * The room's light, read from the shopper's own photo (on this device only).
 *
 * Visible skin (face, neck, hands, arms) is one material seen at many angles:
 * where the fitted body says its surface turns, the photo says how much light
 * it gets. Fitting linear brightness = ambient + light · normal over those
 * pixels gives the light's direction and how soft it is. The skin filled in
 * where an old sleeve or collar is taken out is then shaded by the same light
 * (an arm reads round, its tone meets the hand's at the wrist), and the new
 * garment is lit from the same side as the shopper.
 *
 * Normals are in the photo's view frame: x right, y up, z toward the camera.
 */

export interface PhotoLighting {
  /** Linear brightness of skin facing away from the light (0-1). */
  ambient: number;
  /** Light direction scaled by its strength (linear brightness per unit of n·l). */
  light: [number, number, number];
  /** Skin pixels the fit used. */
  samples: number;
}

/** Fewer usable skin pixels than this and the photo's light is not trusted. */
const MIN_SAMPLES = 400;
/** Robust refits (Huber weights), so a beard, lips or a shadowed eye do not tilt the light. */
const ROBUST_ROUNDS = 3;
const HUBER_K = 0.04;
/** A fit whose ambient is this small against the light is a bad fit (no room is that hard-lit). */
const MIN_AMBIENT_SHARE = 0.15;
/**
 * Skin samples this far from the typical skin brightness are not skin tone
 * (a beard, brows, lips, a shadowed eye socket, teeth): a dark beard on the
 * most camera-facing skin made one photo's light come from behind.
 */
const TONE_BAND_LOW = 0.55;
const TONE_BAND_HIGH = 1.8;
/**
 * The light must reach the camera's side of the body: a fit whose light points
 * this little toward the camera (or away from it) was fooled, not measured.
 */
const MIN_LIGHT_TOWARD_CAMERA = 0.15;

/** Samples within the skin-tone band around the median brightness. */
function toneSamples(normals: Float32Array, luminance: Float32Array): { normals: Float32Array; luminance: Float32Array } {
  const sorted = Float32Array.from(luminance).sort();
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const keep: number[] = [];
  for (let i = 0; i < luminance.length; i += 1) {
    if (luminance[i] >= median * TONE_BAND_LOW && luminance[i] <= median * TONE_BAND_HIGH) {
      keep.push(i);
    }
  }
  const outNormals = new Float32Array(keep.length * 3);
  const outLuminance = new Float32Array(keep.length);
  keep.forEach((index, k) => {
    outNormals.set(normals.subarray(index * 3, index * 3 + 3), k * 3);
    outLuminance[k] = luminance[index];
  });
  return { normals: outNormals, luminance: outLuminance };
}

/** sRGB 0-255 → linear 0-1. */
export function srgbToLinear(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear 0-1 → sRGB 0-255. */
export function linearToSrgb(value: number): number {
  const c = Math.max(0, value);
  return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
}

/** Solve a 4x4 symmetric system by Gaussian elimination; null when singular. */
function solve4(a: number[][], b: number[]): number[] | null {
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 4; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 4; row += 1) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) {
        pivot = row;
      }
    }
    if (Math.abs(m[pivot][col]) < 1e-12) {
      return null;
    }
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let row = 0; row < 4; row += 1) {
      if (row !== col) {
        const factor = m[row][col] / m[col][col];
        for (let k = col; k < 5; k += 1) {
          m[row][k] -= factor * m[col][k];
        }
      }
    }
  }
  return m.map((row, i) => row[4] / row[i]);
}

/**
 * `normals`: 3 per sample (unit, view frame); `luminance`: linear 0-1 per
 * sample. Null when there is too little skin or the fit is implausible.
 */
export function fitPhotoLighting(allNormals: Float32Array, allLuminance: Float32Array): PhotoLighting | null {
  const { normals, luminance } = toneSamples(allNormals, allLuminance);
  const count = luminance.length;
  if (count < MIN_SAMPLES) {
    return null;
  }
  const weights = new Float32Array(count).fill(1);
  let solution: number[] | null = null;
  for (let round = 0; round < ROBUST_ROUNDS; round += 1) {
    const ata = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    const atb = [0, 0, 0, 0];
    for (let i = 0; i < count; i += 1) {
      const row = [1, normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]];
      const w = weights[i];
      for (let r = 0; r < 4; r += 1) {
        atb[r] += w * row[r] * luminance[i];
        for (let c = 0; c < 4; c += 1) {
          ata[r][c] += w * row[r] * row[c];
        }
      }
    }
    for (let r = 1; r < 4; r += 1) {
      ata[r][r] += 1e-3;
    }
    solution = solve4(ata, atb);
    if (!solution) {
      return null;
    }
    for (let i = 0; i < count; i += 1) {
      const predicted = solution[0] + solution[1] * normals[i * 3] + solution[2] * normals[i * 3 + 1] + solution[3] * normals[i * 3 + 2];
      const residual = Math.abs(luminance[i] - predicted);
      weights[i] = residual <= HUBER_K ? 1 : HUBER_K / residual;
    }
  }
  if (!solution) {
    return null;
  }
  const [offset, lx, ly, lz] = solution;
  const strength = Math.hypot(lx, ly, lz);
  if (strength > 1e-6 && lz / strength < MIN_LIGHT_TOWARD_CAMERA) {
    return null;
  }
  // brightness(n) = offset + l·n: the darkest a surface gets is offset - |l| (facing away).
  const ambient = offset - strength;
  if (!(offset > 0)) {
    return null;
  }
  if (ambient >= MIN_AMBIENT_SHARE * offset) {
    return { ambient, light: [lx, ly, lz], samples: count };
  }
  // Too hard a light for any room: keep its direction, soften it to the floor.
  const softened = (offset * (1 - MIN_AMBIENT_SHARE)) / Math.max(strength, 1e-9);
  return { ambient: offset * MIN_AMBIENT_SHARE, light: [lx * softened, ly * softened, lz * softened], samples: count };
}

/** Linear brightness the fitted light gives a surface with this normal. */
export function lightingAt(lighting: PhotoLighting, nx: number, ny: number, nz: number): number {
  const [lx, ly, lz] = lighting.light;
  const strength = Math.hypot(lx, ly, lz);
  return lighting.ambient + strength + lx * nx + ly * ny + lz * nz;
}

/** Unit light direction and the share of light that is ambient (soft) — for the garment shader. */
export function lightForShader(lighting: PhotoLighting): { direction: [number, number, number]; ambientShare: number } {
  const [lx, ly, lz] = lighting.light;
  const strength = Math.hypot(lx, ly, lz) || 1;
  const peak = lighting.ambient + 2 * strength;
  return {
    direction: [lx / strength, ly / strength, lz / strength],
    ambientShare: Math.min(0.9, Math.max(MIN_AMBIENT_SHARE, lighting.ambient / peak)),
  };
}
