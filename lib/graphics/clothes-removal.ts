/**
 * Take the shopper's own clothes out of their photo where the garment they try
 * replaces them (owner decision 2026-10-11, reverses Q16). On this device only:
 * the photo, the clothes mask and the result never leave the browser.
 *
 * Where an old top shows past the new one (a longer hem, a collar, a wider
 * sleeve), it is filled from what would be there without it:
 * - outside the fitted body: the background around the shopper;
 * - on the body above the trouser waistband (and the arms, the neck): the
 *   shopper's own skin, from their visible skin nearby;
 * - on the body below the waistband (a top's hem hanging over trousers): their
 *   own trousers, from the trousers nearby.
 * Each fill is a push-pull diffusion from those source pixels, so it takes the
 * colour of the nearest of them. Pixels the clothes mask is unsure about stay
 * as photographed; when too much is unsure, nothing is removed. Clothes on
 * the head (a headscarf, a hijab, a hat) are never touched: when the head is
 * covered, nothing is removed at all.
 */

/** Per-pixel zone of the fitted body in the photo (`zone` input). */
export const FILL_ZONE = {
  /** Not on the fitted body: background behind the shopper. */
  outside: 0,
  /** Torso above the trouser waistband, neck, arms. */
  upper: 1,
  /** Hips and legs below the waistband. */
  lower: 2,
  /** Head, hands, feet: never touched. */
  keep: 3,
} as const;

export type ReplacedClothes = 'top' | 'bottom' | 'both';

export interface ClothesRemovalInput {
  width: number;
  height: number;
  /** RGBA photo pixels (row-major, `width * height * 4`). */
  photo: Uint8ClampedArray;
  /** Segmenter confidences 0-1, one per pixel. */
  clothes: Float32Array;
  background: Float32Array;
  skin: Float32Array;
  /** New garment coverage 0-255 (its drawn alpha), one per pixel. */
  garment: Uint8Array;
  /** `FILL_ZONE` per pixel, from the fitted body drawn into the photo. */
  zone: Uint8Array;
  /** Rows (pixels) of the natural waist and the crotch in this photo. */
  waistRow: number;
  crotchRow: number;
  replace: ReplacedClothes;
  /**
   * How squarely the fitted body faces the camera (0 edge-on, 1 facing), one
   * per pixel; filled skin darkens toward the body's edges so an arm reads
   * round. Omitted: flat fill.
   */
  facing?: Float32Array;
  /** Deterministic grain in tests. */
  random?: () => number;
}

export interface ClothesRemovalResult {
  /** The cleaned photo; null when nothing was removed. */
  pixels: Uint8ClampedArray | null;
  removedPixels: number;
  /** Removal skipped because the clothes mask is too unsure: tell the shopper why. */
  unsure: boolean;
}

/** A pixel is the old garment at or above this clothes confidence. */
const CLOTHES_SURE = 0.5;
/** Between this and `CLOTHES_SURE` the mask is unsure. */
const CLOTHES_UNSURE = 0.2;
/** Unsure pixels over sure ones above which nothing is removed. */
const MAX_UNSURE_RATIO = 0.6;
/** Source pixels must be at least this sure of their class. */
const SOURCE_SURE = 0.6;
/** Old-garment edge halo taken with it (pixels). */
const HALO_PX = 2;
/** Fewer source pixels than this and that fill is not attempted. */
const MIN_SOURCES = 40;
/** Fill grain (0-255), so a fill is not flatter than the photo around it. */
const GRAIN = 2.5;
/** Head pixels that are clothes above this share: the head is covered. */
const HEAD_COVERED_SHARE = 0.15;
/** Skin shading: edge-on body / facing body brightness. */
const SKIN_EDGE_SHADE = 0.8;
const SKIN_FACING_SHADE = 1.03;
/** 3×3 smoothing passes over filled pixels. */
const SMOOTH_PASSES = 2;

const BINS = 16;

function colourBin(photo: Uint8ClampedArray, pixel: number): number {
  const o = pixel * 4;
  return ((photo[o] >> 4) * BINS + (photo[o + 1] >> 4)) * BINS + (photo[o + 2] >> 4);
}

/**
 * Old top or old bottom, for clothes between the waist and the crotch (a shirt
 * hem over trousers): whichever garment's colours, seen where it is certain,
 * explain the pixel better.
 */
function bottomLikelihood(input: ClothesRemovalInput): (pixel: number) => boolean {
  const { width, height, photo, clothes, waistRow, crotchRow } = input;
  const top = new Float32Array(BINS ** 3);
  const bottom = new Float32Array(BINS ** 3);
  let topCount = 0;
  let bottomCount = 0;
  for (let y = 0; y < height; y += 1) {
    const isTop = y < waistRow;
    const isBottom = y > crotchRow;
    if (!isTop && !isBottom) {
      continue;
    }
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      if (clothes[pixel] < SOURCE_SURE || input.zone[pixel] === FILL_ZONE.keep) {
        continue;
      }
      if (isTop) {
        top[colourBin(photo, pixel)] += 1;
        topCount += 1;
      } else {
        bottom[colourBin(photo, pixel)] += 1;
        bottomCount += 1;
      }
    }
  }
  const prior = 1 / BINS ** 3;
  return (pixel: number) => {
    const bin = colourBin(photo, pixel);
    const pTop = (top[bin] + prior) / (topCount + 1);
    const pBottom = (bottom[bin] + prior) / (bottomCount + 1);
    return pBottom > pTop;
  };
}

/** Which old garment a clothes pixel belongs to. */
function isBottomPixel(input: ClothesRemovalInput, likelihood: (pixel: number) => boolean, pixel: number): boolean {
  const y = Math.floor(pixel / input.width);
  if (y < input.waistRow) {
    return false;
  }
  if (y > input.crotchRow) {
    return true;
  }
  return likelihood(pixel);
}

/**
 * Push-pull fill: `values` (rgb per pixel) known where `weight` > 0; fills the
 * `holes` from the nearest known pixels at every scale.
 */
export function pushPullFill(
  width: number,
  height: number,
  values: Float32Array,
  weight: Float32Array,
): Float32Array {
  const levels: Array<{ w: number; h: number; rgb: Float32Array; a: Float32Array }> = [
    { w: width, h: height, rgb: values, a: weight },
  ];
  while (levels[levels.length - 1].w > 1 || levels[levels.length - 1].h > 1) {
    const fine = levels[levels.length - 1];
    const w = Math.max(1, Math.ceil(fine.w / 2));
    const h = Math.max(1, Math.ceil(fine.h / 2));
    const rgb = new Float32Array(w * h * 3);
    const a = new Float32Array(w * h);
    for (let y = 0; y < fine.h; y += 1) {
      for (let x = 0; x < fine.w; x += 1) {
        const source = y * fine.w + x;
        const alpha = fine.a[source];
        if (alpha <= 0) {
          continue;
        }
        const target = (y >> 1) * w + (x >> 1);
        a[target] += alpha;
        rgb[target * 3] += fine.rgb[source * 3] * alpha;
        rgb[target * 3 + 1] += fine.rgb[source * 3 + 1] * alpha;
        rgb[target * 3 + 2] += fine.rgb[source * 3 + 2] * alpha;
      }
    }
    for (let i = 0; i < w * h; i += 1) {
      if (a[i] > 0) {
        rgb[i * 3] /= a[i];
        rgb[i * 3 + 1] /= a[i];
        rgb[i * 3 + 2] /= a[i];
        a[i] = Math.min(1, a[i]);
      }
    }
    levels.push({ w, h, rgb, a });
  }
  for (let level = levels.length - 2; level >= 0; level -= 1) {
    const fine = levels[level];
    const coarse = levels[level + 1];
    const filled = level === 0 ? new Float32Array(fine.rgb) : fine.rgb;
    for (let y = 0; y < fine.h; y += 1) {
      // Bilinear from the coarse level, so the fill has no block steps.
      const cy = Math.min(coarse.h - 1, Math.max(0, (y - 0.5) / 2));
      const y0 = Math.floor(cy);
      const y1 = Math.min(coarse.h - 1, y0 + 1);
      const fy = cy - y0;
      for (let x = 0; x < fine.w; x += 1) {
        const pixel = y * fine.w + x;
        const alpha = Math.min(1, fine.a[pixel]);
        if (alpha >= 1) {
          continue;
        }
        const cx = Math.min(coarse.w - 1, Math.max(0, (x - 0.5) / 2));
        const x0 = Math.floor(cx);
        const x1 = Math.min(coarse.w - 1, x0 + 1);
        const fx = cx - x0;
        for (let c = 0; c < 3; c += 1) {
          const top = coarse.rgb[(y0 * coarse.w + x0) * 3 + c] * (1 - fx) + coarse.rgb[(y0 * coarse.w + x1) * 3 + c] * fx;
          const bottom = coarse.rgb[(y1 * coarse.w + x0) * 3 + c] * (1 - fx) + coarse.rgb[(y1 * coarse.w + x1) * 3 + c] * fx;
          const up = top * (1 - fy) + bottom * fy;
          filled[pixel * 3 + c] = fine.rgb[pixel * 3 + c] * alpha + up * (1 - alpha);
        }
        if (level > 0) {
          fine.a[pixel] = 1;
        }
      }
    }
    if (level === 0) {
      return filled;
    }
  }
  return new Float32Array(values);
}

type FillKind = 'background' | 'skin' | 'trousers';

export function removeReplacedClothes(input: ClothesRemovalInput): ClothesRemovalResult {
  const { width, height, photo, clothes, background, skin, garment, zone, replace } = input;
  const count = width * height;
  const likelihood = bottomLikelihood(input);
  const replacesTop = replace !== 'bottom';
  const replacesBottom = replace !== 'top';

  // A covered head (headscarf, hijab): its cloth may fall over the shoulders, so leave everything.
  let headPixels = 0;
  let headClothes = 0;
  for (let pixel = 0; pixel < count; pixel += 1) {
    if (zone[pixel] === FILL_ZONE.keep && pixel < input.waistRow * width) {
      headPixels += 1;
      if (clothes[pixel] >= CLOTHES_SURE) {
        headClothes += 1;
      }
    }
  }
  if (headPixels > 0 && headClothes / headPixels > HEAD_COVERED_SHARE) {
    return { pixels: null, removedPixels: 0, unsure: false };
  }

  // The old garment's pixels the new one leaves showing.
  const remove = new Uint8Array(count);
  let sure = 0;
  let unsure = 0;
  for (let pixel = 0; pixel < count; pixel += 1) {
    if (garment[pixel] >= 250 || zone[pixel] === FILL_ZONE.keep || clothes[pixel] < CLOTHES_UNSURE) {
      continue;
    }
    const bottom = isBottomPixel(input, likelihood, pixel);
    if (bottom ? !replacesBottom : !replacesTop) {
      continue;
    }
    if (clothes[pixel] >= CLOTHES_SURE) {
      remove[pixel] = 1;
      sure += 1;
    } else {
      unsure += 1;
    }
  }
  if (sure === 0) {
    return { pixels: null, removedPixels: 0, unsure: false };
  }
  if (unsure / sure > MAX_UNSURE_RATIO) {
    return { pixels: null, removedPixels: 0, unsure: true };
  }

  // Unsure pixels joined to the sure ones are the same garment (a white cuff
  // against a white wall): they go too.
  const queue: number[] = [];
  for (let pixel = 0; pixel < count; pixel += 1) {
    if (remove[pixel]) {
      queue.push(pixel);
    }
  }
  while (queue.length > 0) {
    const pixel = queue.pop() as number;
    const x = pixel % width;
    for (const next of [pixel - 1, pixel + 1, pixel - width, pixel + width]) {
      if (next < 0 || next >= count || remove[next] || (next === pixel - 1 && x === 0) || (next === pixel + 1 && x === width - 1)) {
        continue;
      }
      if (
        clothes[next] < CLOTHES_UNSURE ||
        garment[next] >= 250 ||
        zone[next] === FILL_ZONE.keep ||
        skin[next] >= CLOTHES_SURE ||
        (isBottomPixel(input, likelihood, next) ? !replacesBottom : !replacesTop)
      ) {
        continue;
      }
      remove[next] = 1;
      queue.push(next);
    }
  }

  // Its anti-aliased edge goes with it (never into skin, the head or the new garment).
  for (let pass = 0; pass < HALO_PX; pass += 1) {
    const grown = remove.slice();
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const pixel = y * width + x;
        if (remove[pixel] || zone[pixel] === FILL_ZONE.keep || garment[pixel] >= 250 || skin[pixel] >= CLOTHES_SURE) {
          continue;
        }
        if (remove[pixel - 1] || remove[pixel + 1] || remove[pixel - width] || remove[pixel + width]) {
          grown[pixel] = 2;
        }
      }
    }
    remove.set(grown);
  }

  const kindOf = (pixel: number): FillKind => {
    const z = zone[pixel];
    if (z === FILL_ZONE.outside) {
      return 'background';
    }
    if (z === FILL_ZONE.lower && !replacesBottom) {
      return 'trousers';
    }
    return 'skin';
  };

  const needed = new Set<FillKind>();
  let removedPixels = 0;
  for (let pixel = 0; pixel < count; pixel += 1) {
    if (remove[pixel]) {
      needed.add(kindOf(pixel));
      removedPixels += 1;
    }
  }

  const out = new Uint8ClampedArray(photo);
  const random = input.random ?? Math.random;
  for (const kind of needed) {
    const values = new Float32Array(count * 3);
    const weight = new Float32Array(count);
    let sources = 0;
    for (let pixel = 0; pixel < count; pixel += 1) {
      if (remove[pixel] || garment[pixel] > 0) {
        continue;
      }
      const isSource =
        kind === 'background'
          ? background[pixel] >= SOURCE_SURE
          : kind === 'skin'
            ? skin[pixel] >= SOURCE_SURE
            : clothes[pixel] >= SOURCE_SURE && zone[pixel] !== FILL_ZONE.keep && isBottomPixel(input, likelihood, pixel);
      if (!isSource) {
        continue;
      }
      weight[pixel] = 1;
      values[pixel * 3] = photo[pixel * 4];
      values[pixel * 3 + 1] = photo[pixel * 4 + 1];
      values[pixel * 3 + 2] = photo[pixel * 4 + 2];
      sources += 1;
    }
    if (sources < MIN_SOURCES) {
      // Nothing to take this fill from (no visible skin, say): leave those pixels.
      continue;
    }
    const filled = pushPullFill(width, height, values, weight);
    for (let pixel = 0; pixel < count; pixel += 1) {
      if (!remove[pixel] || kindOf(pixel) !== kind) {
        continue;
      }
      // Soft edge: the halo and unsure edge blend with the photo by confidence.
      const alpha = remove[pixel] === 1 ? 1 : Math.min(1, Math.max(0.35, clothes[pixel] / CLOTHES_SURE));
      const grain = (random() - 0.5) * 2 * GRAIN;
      const shade =
        kind === 'skin' && input.facing
          ? SKIN_EDGE_SHADE + (SKIN_FACING_SHADE - SKIN_EDGE_SHADE) * Math.sqrt(input.facing[pixel])
          : 1;
      for (let c = 0; c < 3; c += 1) {
        const o = pixel * 4 + c;
        out[o] = Math.round(photo[o] * (1 - alpha) + (filled[pixel * 3 + c] * shade + grain) * alpha);
      }
    }
  }
  // Soften the fill (stair-steps where the body outline meets the background).
  for (let pass = 0; pass < SMOOTH_PASSES; pass += 1) {
    const source = new Uint8ClampedArray(out);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const pixel = y * width + x;
        if (!remove[pixel]) {
          continue;
        }
        for (let c = 0; c < 3; c += 1) {
          let sum = 0;
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              sum += source[((y + dy) * width + x + dx) * 4 + c];
            }
          }
          out[pixel * 4 + c] = Math.round(sum / 9);
        }
      }
    }
  }
  return { pixels: out, removedPixels, unsure: false };
}
