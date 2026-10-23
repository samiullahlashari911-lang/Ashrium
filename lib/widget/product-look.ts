import { extractGarmentLook, type GarmentLook } from '@/lib/graphics/garment-look';
import { segmentPerson } from '@/lib/widget/clothes-segmenter';
import type { GarmentCategory } from '@/types/garment';

/**
 * The product photo's look (fabric, front, colour), lifted on this device from
 * the merchant's public product image. One per photo and category per page.
 */

/** The photo is read at this height: enough for a knit's texture, quick on a phone. */
const LOOK_PHOTO_PX = 720;

const looks = new Map<string, Promise<GarmentLook | null>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Product photo could not be loaded.'));
    image.src = url;
  });
}

async function lift(url: string, category: GarmentCategory | null, garmentWidthCm: number): Promise<GarmentLook | null> {
  const image = await loadImage(url);
  const scale = Math.min(1, LOOK_PHOTO_PX / image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return null;
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    let clothes: Float32Array | null = null;
    try {
      clothes = (await segmentPerson(canvas)).clothes;
    } catch {
      // No segmenter on this phone: a product shot still works from its backdrop.
    }
    return extractGarmentLook(
      { width: pixels.width, height: pixels.height, data: pixels.data },
      clothes,
      category,
      garmentWidthCm,
    );
  } finally {
    canvas.width = 0;
  }
}

/** The garment's look from its product photo, or null when the photo cannot give one. */
export function productLook(url: string, category: GarmentCategory | null, garmentWidthCm: number): Promise<GarmentLook | null> {
  const key = `${url}|${category ?? ''}|${Math.round(garmentWidthCm)}`;
  let look = looks.get(key);
  if (!look) {
    look = lift(url, category, garmentWidthCm).catch((error: unknown) => {
      console.warn('Product look unavailable; drawing the garment in its colour', error);
      return null;
    });
    looks.set(key, look);
  }
  return look;
}
