import { pushPullFill } from '@/lib/graphics/clothes-removal';
import { boxBlur } from '@/lib/graphics/mask-filter';
import { srgbToLinear } from '@/lib/graphics/photo-lighting';

/**
 * How the room's light falls across the shopper's body, read from their own
 * photo (on this device only). Their old clothes and their skin are each one
 * material, so each one's brightness divided by its own average is the light
 * reaching that spot: a white shirt records the light on the torso and arms
 * almost exactly. Smoothed past the scale of fabric texture and old wrinkles,
 * it keeps the form light (a torso's sides turning darker, the chest catching
 * the window) that a drape lit by a guessed light lacks. The new garment is
 * shaded by it and filled-in skin is lit by it, so both sit in the photo's
 * own light.
 */
export interface PhotoShadingInput {
  width: number;
  height: number;
  /** RGBA photo pixels. */
  photo: Uint8ClampedArray;
  /** Segmenter confidences 0-1 per pixel. */
  clothes: Float32Array;
  skin: Float32Array;
  /** 1 where the fitted body is (light is read on the shopper, never the wall). */
  onBody: Uint8Array;
  /** Smoothing radius (pixels): larger than a fabric's weave and an old garment's small wrinkles. */
  radius: number;
}

/** A pixel is used when its class is at least this sure. */
const SURE = 0.6;
/** Fewer used pixels than this and the photo's light is not read. */
const MIN_PIXELS = 500;
/** Relative light is kept in this range (a seam in shadow, a bright fold). */
const LOW = 0.55;
const HIGH = 1.45;
/** Pixels too dark to say anything about the light (black clothes, deep shadow). */
const MIN_LUMINANCE = 0.004;

/**
 * Relative light per pixel (1 = this material's average light), smooth and
 * defined everywhere; null when too little of the shopper is sure enough.
 */
export function photoShading(input: PhotoShadingInput): Float32Array | null {
  const { width, height, photo, clothes, skin, onBody, radius } = input;
  const count = width * height;
  const luminance = new Float32Array(count);
  const kind = new Uint8Array(count);
  const sums = [0, 0, 0];
  const counts = [0, 0, 0];
  for (let pixel = 0; pixel < count; pixel += 1) {
    if (!onBody[pixel]) {
      continue;
    }
    const value =
      0.2126 * srgbToLinear(photo[pixel * 4]) + 0.7152 * srgbToLinear(photo[pixel * 4 + 1]) + 0.0722 * srgbToLinear(photo[pixel * 4 + 2]);
    if (value < MIN_LUMINANCE) {
      continue;
    }
    const k = clothes[pixel] >= SURE ? 1 : skin[pixel] >= SURE ? 2 : 0;
    if (k === 0) {
      continue;
    }
    kind[pixel] = k;
    luminance[pixel] = value;
    sums[k] += value;
    counts[k] += 1;
  }
  if (counts[1] + counts[2] < MIN_PIXELS) {
    return null;
  }
  const values = new Float32Array(count * 3);
  const weight = new Float32Array(count);
  for (let pixel = 0; pixel < count; pixel += 1) {
    const k = kind[pixel];
    if (k === 0 || counts[k] === 0) {
      continue;
    }
    const relative = Math.min(HIGH, Math.max(LOW, luminance[pixel] / (sums[k] / counts[k])));
    values[pixel * 3] = relative;
    weight[pixel] = 1;
  }
  const filled = pushPullFill(width, height, values, weight);
  const single = new Float32Array(count);
  for (let pixel = 0; pixel < count; pixel += 1) {
    single[pixel] = filled[pixel * 3];
  }
  let smooth: Float32Array = single;
  const r = Math.max(1, Math.round(radius / Math.sqrt(3)));
  for (let pass = 0; pass < 3; pass += 1) {
    smooth = boxBlur(smooth, width, height, r);
  }
  return smooth;
}
