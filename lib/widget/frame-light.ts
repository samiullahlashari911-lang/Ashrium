/**
 * On-device exposure correction for capture frames: a dim room, a window
 * behind the shopper or a washed-out frame is levelled before pose detection,
 * the uploaded headless WebP and the on-device photo, so every step sees the
 * body clearly in any light. One tone curve (black/white point + gamma),
 * measured on the body where landmarks give it, applied the same to R, G and B.
 * Runs in the browser on pixels that are already on this device.
 */

/** Brightness (0-1) the body's mean is moved toward. */
const TARGET_MEAN = 0.46;
/** Never stretch the tone range more than this (noise in a dark room). */
const MAX_GAIN = 3;
/** Smallest tone range considered (a flat frame is not stretched to noise). */
const MIN_RANGE = 48;
const GAMMA_MIN = 0.45;
const GAMMA_MAX = 1.6;
/** Frames this close to the target are left untouched. */
const IDENTITY_GAMMA_TOLERANCE = 0.08;
const IDENTITY_BLACK_POINT = 10;
const IDENTITY_WHITE_POINT = 240;
const SAMPLE_WIDTH_PX = 96;

/** 256-entry tone curve, or null when the frame already looks right. */
export type LightCurve = Uint8ClampedArray | null;

export interface LightBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Tone curve from grey values (0-255) of the region that matters. */
export function lightCurveFromGray(gray: ArrayLike<number>): LightCurve {
  const count = gray.length;
  if (count === 0) {
    return null;
  }
  const histogram = new Uint32Array(256);
  let sum = 0;
  for (let i = 0; i < count; i += 1) {
    const value = Math.max(0, Math.min(255, Math.round(gray[i]!)));
    histogram[value]! += 1;
    sum += value;
  }
  const percentile = (fraction: number): number => {
    const target = fraction * count;
    let seen = 0;
    for (let value = 0; value < 256; value += 1) {
      seen += histogram[value]!;
      if (seen >= target) {
        return value;
      }
    }
    return 255;
  };

  let low = percentile(0.01);
  let high = percentile(0.99);
  if (high - low < MIN_RANGE) {
    const middle = (high + low) / 2;
    low = Math.max(0, middle - MIN_RANGE / 2);
    high = Math.min(255, low + MIN_RANGE);
  }
  if ((high - low) * MAX_GAIN < 255) {
    high = Math.min(255, low + 255 / MAX_GAIN);
  }

  const range = high - low;
  const mean = Math.min(0.98, Math.max(0.02, (sum / count - low) / range));
  const gamma = Math.min(GAMMA_MAX, Math.max(GAMMA_MIN, Math.log(TARGET_MEAN) / Math.log(mean)));
  if (
    Math.abs(gamma - 1) < IDENTITY_GAMMA_TOLERANCE
    && low <= IDENTITY_BLACK_POINT
    && high >= IDENTITY_WHITE_POINT
  ) {
    return null;
  }

  const curve = new Uint8ClampedArray(256);
  for (let value = 0; value < 256; value += 1) {
    const level = Math.min(1, Math.max(0, (value - low) / range));
    curve[value] = Math.round(255 * level ** gamma);
  }
  return curve;
}

/** Apply a tone curve to RGBA pixels in place (alpha untouched). */
export function applyLightCurve(rgba: Uint8ClampedArray, curve: Uint8ClampedArray): void {
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = curve[rgba[i]!]!;
    rgba[i + 1] = curve[rgba[i + 1]!]!;
    rgba[i + 2] = curve[rgba[i + 2]!]!;
  }
}

/** Browser helper: measure a source (optionally only `box`, in source pixels) on a small copy. */
export function measureLightCurve(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  box?: LightBox | null,
): LightCurve {
  const sx = box?.x ?? 0;
  const sy = box?.y ?? 0;
  const sw = Math.max(1, box?.width ?? sourceWidth);
  const sh = Math.max(1, box?.height ?? sourceHeight);
  const width = Math.max(1, Math.min(SAMPLE_WIDTH_PX, Math.round(sw)));
  const height = Math.max(1, Math.round((sh * width) / sw));
  const small = document.createElement('canvas');
  small.width = width;
  small.height = height;
  const context = small.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return null;
  }
  context.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  small.width = 0;
  small.height = 0;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i += 1) {
    gray[i] = 0.2126 * pixels[i * 4]! + 0.7152 * pixels[i * 4 + 1]! + 0.0722 * pixels[i * 4 + 2]!;
  }
  return lightCurveFromGray(gray);
}

/** Browser helper: apply a curve to a whole 2D canvas in place. */
export function applyLightCurveToCanvas(canvas: HTMLCanvasElement, curve: LightCurve): void {
  if (!curve || canvas.width === 0 || canvas.height === 0) {
    return;
  }
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return;
  }
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  applyLightCurve(image.data, curve);
  context.putImageData(image, 0, 0);
}
