/**
 * Light and sharpness check on a capture (spec Q9): a frame that cannot paint
 * a recognisable avatar is retaken at once, with the reason, instead of
 * failing later. Runs on a small grey copy of the frame, on the device.
 * Thresholds are deliberately conservative: only clearly dark or clearly
 * blurred frames are refused.
 */
export type FrameQuality = 'ok' | 'too_dark' | 'blurry';

export const FRAME_QUALITY_WIDTH_PX = 192;
/** Mean brightness (0-255) below this is too dark to see a face. */
const MIN_MEAN_LUMA = 45;
/** Strong edges (98th percentile of |Laplacian|) below this mean motion or focus blur. */
const MIN_EDGE_STRENGTH = 6;

export const FRAME_QUALITY_COPY: Record<Exclude<FrameQuality, 'ok'>, string> = {
  too_dark: 'Too dark to see you clearly. Turn on a light or face a window, then hold the pose again.',
  blurry: 'The photo came out blurry. Hold still until the photo is taken.',
};

export function grayscaleFromRgba(rgba: ArrayLike<number>, pixelCount: number): Float32Array {
  const gray = new Float32Array(pixelCount);
  for (let i = 0; i < pixelCount; i += 1) {
    gray[i] = 0.2126 * rgba[i * 4]! + 0.7152 * rgba[i * 4 + 1]! + 0.0722 * rgba[i * 4 + 2]!;
  }
  return gray;
}

export function assessFrameQuality(gray: Float32Array, width: number, height: number): FrameQuality {
  let sum = 0;
  for (let i = 0; i < gray.length; i += 1) {
    sum += gray[i]!;
  }
  if (sum / Math.max(gray.length, 1) < MIN_MEAN_LUMA) {
    return 'too_dark';
  }
  const edges: number[] = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      edges.push(Math.abs(4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - width]! - gray[i + width]!));
    }
  }
  if (edges.length === 0) {
    return 'ok';
  }
  edges.sort((a, b) => a - b);
  return edges[Math.floor(edges.length * 0.98)]! < MIN_EDGE_STRENGTH ? 'blurry' : 'ok';
}

/** Browser helper: grey copy of a canvas at FRAME_QUALITY_WIDTH_PX. */
export function assessCanvasQuality(frame: HTMLCanvasElement): FrameQuality {
  const width = Math.min(FRAME_QUALITY_WIDTH_PX, frame.width);
  const height = Math.max(1, Math.round((frame.height * width) / Math.max(frame.width, 1)));
  const small = document.createElement('canvas');
  small.width = width;
  small.height = height;
  const context = small.getContext('2d', { willReadFrequently: true });
  if (!context || width < 3 || height < 3) {
    return 'ok';
  }
  context.drawImage(frame, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  small.width = 0;
  small.height = 0;
  return assessFrameQuality(grayscaleFromRgba(pixels, width * height), width, height);
}
