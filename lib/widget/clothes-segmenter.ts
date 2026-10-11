import type { ImageSegmenter } from '@mediapipe/tasks-vision';

/**
 * On-device person segmentation (MediaPipe selfie multiclass): which pixels of
 * the shopper's photo are their clothes, their skin, or the background. Used
 * only to take their own clothes out where a tried garment replaces them
 * (`lib/graphics/clothes-removal.ts`). Runs in the browser; the photo and the
 * masks never leave this device.
 */

const MEDIAPIPE_VERSION = '1.0.1';
const WASM_BASE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite';

/** Model categories (selfie_multiclass_256x256). */
const CATEGORY = { background: 0, hair: 1, bodySkin: 2, faceSkin: 3, clothes: 4, others: 5 } as const;

export interface PersonMasks {
  width: number;
  height: number;
  clothes: Float32Array;
  background: Float32Array;
  skin: Float32Array;
}

let segmenterPromise: Promise<ImageSegmenter> | null = null;

/** Start the download early (during the loading screen); one model per page. */
export function preloadClothesSegmenter(): Promise<ImageSegmenter> {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
      const create = (delegate: 'GPU' | 'CPU') =>
        ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: 'IMAGE',
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });
      try {
        return await create('GPU');
      } catch {
        return create('CPU');
      }
    })();
    segmenterPromise.catch(() => {
      segmenterPromise = null;
    });
  }
  return segmenterPromise;
}

/** Bilinear-sample a model mask into a `width`×`tileHeight` window of `out` starting at row `top`. */
function blitMask(
  mask: Float32Array,
  maskWidth: number,
  maskHeight: number,
  out: Float32Array,
  weights: Float32Array | null,
  width: number,
  top: number,
  tileHeight: number,
  imageHeight: number,
): void {
  for (let y = 0; y < tileHeight; y += 1) {
    const row = top + y;
    if (row < 0 || row >= imageHeight) {
      continue;
    }
    // Tiles overlap; the middle of a tile counts more than its edges.
    const centre = 1 - Math.abs((y + 0.5) / tileHeight - 0.5) * 1.6;
    const sy = Math.min(maskHeight - 1, Math.max(0, ((y + 0.5) / tileHeight) * maskHeight - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(maskHeight - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(maskWidth - 1, Math.max(0, ((x + 0.5) / width) * maskWidth - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(maskWidth - 1, x0 + 1);
      const fx = sx - x0;
      const value =
        (mask[y0 * maskWidth + x0] * (1 - fx) + mask[y0 * maskWidth + x1] * fx) * (1 - fy) +
        (mask[y1 * maskWidth + x0] * (1 - fx) + mask[y1 * maskWidth + x1] * fx) * fy;
      out[row * width + x] += value * centre;
      if (weights) {
        weights[row * width + x] += centre;
      }
    }
  }
}

/**
 * Segment `image` (a tall photo of a standing person). The model sees a
 * 256×256 square, so the photo runs as overlapping square tiles down its
 * height: a whole-body squash would lose the collar and the hem.
 */
export async function segmentPerson(image: HTMLCanvasElement): Promise<PersonMasks> {
  const segmenter = await preloadClothesSegmenter();
  const { width, height } = image;
  const side = Math.min(width, height);
  const tiles = Math.max(1, Math.ceil((height - side) / (side * 0.6)) + 1);
  const step = tiles > 1 ? (height - side) / (tiles - 1) : 0;
  const tile = document.createElement('canvas');
  tile.width = side;
  tile.height = side;
  const context = tile.getContext('2d');
  if (!context) {
    throw new Error('No 2D canvas for segmentation.');
  }
  const sums = {
    clothes: new Float32Array(width * height),
    background: new Float32Array(width * height),
    skin: new Float32Array(width * height),
  };
  const weights = new Float32Array(width * height);
  try {
    for (let t = 0; t < tiles; t += 1) {
      const top = Math.round(t * step);
      context.clearRect(0, 0, side, side);
      context.drawImage(image, 0, top, width, side, 0, 0, side, side);
      const result = segmenter.segment(tile);
      const masks = result.confidenceMasks ?? [];
      try {
        const read = (category: number) => masks[category]?.getAsFloat32Array() ?? null;
        const clothes = read(CATEGORY.clothes);
        const background = read(CATEGORY.background);
        const bodySkin = read(CATEGORY.bodySkin);
        const faceSkin = read(CATEGORY.faceSkin);
        const mask = masks[CATEGORY.clothes];
        if (!clothes || !background || !bodySkin || !faceSkin || !mask) {
          throw new Error('Segmenter returned no masks.');
        }
        const skin = new Float32Array(bodySkin.length);
        for (let i = 0; i < skin.length; i += 1) {
          skin[i] = Math.min(1, bodySkin[i] + faceSkin[i]);
        }
        blitMask(clothes, mask.width, mask.height, sums.clothes, weights, width, top, side, height);
        blitMask(background, mask.width, mask.height, sums.background, null, width, top, side, height);
        blitMask(skin, mask.width, mask.height, sums.skin, null, width, top, side, height);
      } finally {
        for (const mask of masks) {
          mask.close();
        }
      }
    }
  } finally {
    tile.width = 0;
  }
  for (let i = 0; i < width * height; i += 1) {
    const w = weights[i] || 1;
    sums.clothes[i] /= w;
    sums.background[i] /= w;
    sums.skin[i] /= w;
  }
  return { width, height, ...sums };
}

/** Bilinear resize of a confidence mask. */
export function resizeMask(mask: Float32Array, width: number, height: number, outWidth: number, outHeight: number): Float32Array {
  if (width === outWidth && height === outHeight) {
    return mask;
  }
  const out = new Float32Array(outWidth * outHeight);
  for (let y = 0; y < outHeight; y += 1) {
    const sy = Math.min(height - 1, Math.max(0, ((y + 0.5) * height) / outHeight - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < outWidth; x += 1) {
      const sx = Math.min(width - 1, Math.max(0, ((x + 0.5) * width) / outWidth - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(width - 1, x0 + 1);
      const fx = sx - x0;
      const top = mask[y0 * width + x0] * (1 - fx) + mask[y0 * width + x1] * fx;
      const bottom = mask[y1 * width + x0] * (1 - fx) + mask[y1 * width + x1] * fx;
      out[y * outWidth + x] = top * (1 - fy) + bottom * fy;
    }
  }
  return out;
}
