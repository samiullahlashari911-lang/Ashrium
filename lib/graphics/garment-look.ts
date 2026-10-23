import type { GarmentCategory } from '@/types/garment';

/**
 * The real garment's look, lifted from its public product photo: the fabric
 * (a seamless tile at its true size), the front (prints, buttons, pockets) and
 * its colour. Runs on the shopper's phone; no pixels are generated, only the
 * merchant's own photo is resampled. See
 * docs/superpowers/specs/2026-10-23-real-garment-look-design.md.
 */

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface GarmentLook {
  /** The garment's colour in the photo, sRGB 0-1. */
  meanRgb: [number, number, number];
  /** Seamless fabric tile, sRGB, light removed. */
  fabric: RgbaImage;
  /** Edge length of one fabric tile on the garment, metres. */
  fabricMetres: number;
  /**
   * The garment's front, light removed; alpha 0 where the photo does not show
   * it (hands, bags, hair). Null when the photo does not show the whole front
   * cleanly: the fabric and colour are still real, the details are left out.
   */
  front: RgbaImage | null;
  /** Per row of `front`: left and right edge of the garment (px), or -1 where the row is empty. */
  frontRows: Int32Array | null;
}

/** Front maps are used only from photos showing at least this much of the garment's outline. */
const MIN_FRONT_SEEN = 0.85;
/** Outline area over its bounding box: lower is a garment in pieces (hair across it, a missing leg). */
const MIN_FRONT_SOLIDITY = { top: 0.5, bottom: 0.4 };
/** Outline length over its box's: hair, hands or a lost leg make it ragged. */
const MAX_FRONT_RAGGED = 1.8;
/** Trousers: share of the lower rows that show two legs (one leg = a side view or a stride). */
const MIN_TWO_LEG_ROWS = 0.3;
/** Height over width of the outline: trousers are long, tops roughly square. */
const FRONT_ASPECT = { top: [0.6, 1.9], bottom: [1.5, 4.5] } as const;

const TOP_CATEGORIES: ReadonlySet<GarmentCategory> = new Set(['tee', 'outerwear', 'dress'] as GarmentCategory[]);
/** Below this share of the photo, the segmenter saw no clothes (a product shot): use the backdrop instead. */
const MIN_CLOTHES_SHARE = 0.03;
/** The segmenter is only half sure of dark denim and black cloth. */
const CLOTHES_CONFIDENCE = 0.3;
/** Colour step (0-1 RGB) between two stacked garments (a pink tee over beige trousers). */
const GARMENT_SPLIT_STEP = 0.12;
/** A row may be at most this much wider than the garment's typical width (sleeves on a model's arms). */
const ROW_WIDTH_CAP = 1.15;
/** Light removal never brightens or darkens a pixel by more than this factor. */
const MAX_DELIGHT_GAIN = 1.3;
/** Light removal follows the photo's light over this share of the garment's width. */
const DELIGHT_RADIUS_SHARE = 0.22;
/** The plain fabric around a detail: its colour over this share of the garment's width. */
const DETAIL_BASE_RADIUS_SHARE = 0.08;
/** Chroma difference (normalised RGB) from no detail to a full detail. */
const DETAIL_CHROMA = [0.025, 0.065] as const;
/** Brightness difference (|log ratio|) from no detail to a full detail; folds stay below it. */
const DETAIL_CONTRAST = [0.6, 0.9] as const;
/** Fabric patch edge as a share of the garment's width. */
const PATCH_SHARE = 0.2;

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Box blur of `values` weighted by `weights` (normalised convolution), radius in px. */
export function maskedBlur(values: Float32Array, weights: Float32Array, width: number, height: number, radius: number): Float32Array {
  const pass = (input: Float32Array, horizontal: boolean): Float32Array => {
    const out = new Float32Array(input.length);
    const lines = horizontal ? height : width;
    const length = horizontal ? width : height;
    for (let line = 0; line < lines; line += 1) {
      let sum = 0;
      const at = (i: number): number => (horizontal ? line * width + i : i * width + line);
      for (let i = -radius; i <= radius; i += 1) {
        sum += input[at(Math.min(length - 1, Math.max(0, i)))];
      }
      for (let i = 0; i < length; i += 1) {
        out[at(i)] = sum;
        sum += input[at(Math.min(length - 1, i + radius + 1))] - input[at(Math.max(0, i - radius))];
      }
    }
    return out;
  };
  const weighted = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    weighted[i] = values[i] * weights[i];
  }
  const num = pass(pass(weighted, true), false);
  const den = pass(pass(weights, true), false);
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    out[i] = den[i] > 1e-6 ? num[i] / den[i] : 0;
  }
  return out;
}

/** Largest 4-connected component of `mask` touching any `seed` pixel (or the largest overall). */
function keepSeededComponent(mask: Uint8Array, seed: Uint8Array, width: number, height: number): Uint8Array {
  const label = new Int32Array(mask.length).fill(-1);
  const stack: number[] = [];
  let best = -1;
  let bestScore = -1;
  let next = 0;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || label[start] >= 0) {
      continue;
    }
    let size = 0;
    let seeded = 0;
    stack.push(start);
    label[start] = next;
    while (stack.length > 0) {
      const p = stack.pop() as number;
      size += 1;
      seeded += seed[p];
      const x = p % width;
      const neighbours = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width];
      for (const q of neighbours) {
        if (q >= 0 && q < mask.length && mask[q] && label[q] < 0) {
          label[q] = next;
          stack.push(q);
        }
      }
    }
    const score = seeded * mask.length + size;
    if (score > bestScore) {
      bestScore = score;
      best = next;
    }
    next += 1;
  }
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i += 1) {
    out[i] = label[i] === best && best >= 0 ? 1 : 0;
  }
  return out;
}

/** Fill holes: background pixels not reachable from the image border become garment. */
function fillHoles(mask: Uint8Array, width: number, height: number): Uint8Array {
  const outside = new Uint8Array(mask.length);
  const stack: number[] = [];
  const push = (p: number): void => {
    if (!mask[p] && !outside[p]) {
      outside[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < width; x += 1) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (stack.length > 0) {
    const p = stack.pop() as number;
    const x = p % width;
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (p >= width) push(p - width);
    if (p < mask.length - width) push(p + width);
  }
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i += 1) {
    out[i] = outside[i] ? 0 : 1;
  }
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export interface GarmentRegion {
  /** The garment's outline, holes filled (prints and buttons included). */
  region: Uint8Array;
  /** Pixels where the photo really shows the garment (no hands, bags, hair). */
  seen: Uint8Array;
  seedRgb: [number, number, number];
  /** No one wears it: the segmenter saw no clothes, so the backdrop gave the outline. */
  productShot: boolean;
}

/**
 * Where the product is in its photo. `clothes`: the on-device segmenter's
 * clothes confidence (null or empty for a product shot without a person).
 * Tops are seeded in the upper part of the clothes, bottoms in the lower, then
 * grown by colour so the model's other clothes are left out.
 */
export function findGarment(image: RgbaImage, clothes: Float32Array | null, category: GarmentCategory | null): GarmentRegion {
  const { width, height, data } = image;
  const n = width * height;
  let candidates = new Uint8Array(n);
  let clothesShare = 0;
  if (clothes) {
    for (let i = 0; i < n; i += 1) {
      candidates[i] = clothes[i] > CLOTHES_CONFIDENCE ? 1 : 0;
      clothesShare += candidates[i];
    }
    clothesShare /= n;
  }
  const productShot = clothesShare < MIN_CLOTHES_SHARE;
  if (productShot) {
    // Backdrop = the border's colour; the garment is whatever differs from it.
    const border: number[][] = [];
    for (let x = 0; x < width; x += 4) {
      border.push([x, 0], [x, height - 1]);
    }
    for (let y = 0; y < height; y += 4) {
      border.push([0, y], [width - 1, y]);
    }
    const channel = (c: number): number => median(border.map(([x, y]) => data[(y * width + x) * 4 + c]));
    const backdrop = [channel(0), channel(1), channel(2)];
    candidates = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) {
      const d = Math.hypot(data[i * 4] - backdrop[0], data[i * 4 + 1] - backdrop[1], data[i * 4 + 2] - backdrop[2]);
      candidates[i] = d > 28 ? 1 : 0;
    }
  }

  // Clothes rows, top to bottom, with each row's median colour.
  let top = height;
  let bottom = -1;
  for (let i = 0; i < n; i += 1) {
    if (candidates[i]) {
      const y = Math.floor(i / width);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  const seed = new Uint8Array(n);
  if (bottom < 0) {
    return { region: seed, seen: seed, seedRgb: [0.5, 0.5, 0.5], productShot };
  }
  const span = Math.max(1, bottom - top);
  const rowColour: Array<[number, number, number] | null> = [];
  for (let y = top; y <= bottom; y += 1) {
    const r: number[] = [];
    const g: number[] = [];
    const b: number[] = [];
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (candidates[i]) {
        r.push(data[i * 4]);
        g.push(data[i * 4 + 1]);
        b.push(data[i * 4 + 2]);
      }
    }
    rowColour.push(r.length > 4 ? [median(r) / 255, median(g) / 255, median(b) / 255] : null);
  }
  // Where two garments meet (a tee over trousers), the clothes' colour steps.
  const window = Math.max(3, Math.round(span * 0.08));
  const meanOf = (from: number, to: number): [number, number, number] | null => {
    const sum = [0, 0, 0];
    let count = 0;
    for (let k = Math.max(0, from); k < Math.min(rowColour.length, to); k += 1) {
      const c = rowColour[k];
      if (c) {
        sum[0] += c[0];
        sum[1] += c[1];
        sum[2] += c[2];
        count += 1;
      }
    }
    return count > 0 ? [sum[0] / count, sum[1] / count, sum[2] / count] : null;
  };
  // A top ends at its hem (the middle of the clothes); trousers start at the
  // waist (the upper part): lighting steps further down a leg are not a garment edge.
  const isTop = category === null || TOP_CATEGORIES.has(category);
  const [searchFrom, searchTo] = isTop ? [0.3, 0.75] : [0.08, 0.45];
  let split = -1;
  let bestStep = GARMENT_SPLIT_STEP;
  for (let k = Math.round(span * searchFrom); k <= Math.round(span * searchTo); k += 1) {
    const above = meanOf(k - window, k);
    const below = meanOf(k, k + window);
    if (above && below) {
      const step = Math.hypot(above[0] - below[0], above[1] - below[1], above[2] - below[2]);
      if (step > bestStep) {
        bestStep = step;
        split = top + k;
      }
    }
  }
  const [bandTop, bandBottom] = split < 0 ? [top, bottom] : isTop ? [top, split - 1] : [split, bottom];
  const bandSpan = Math.max(1, bandBottom - bandTop);
  // Seed in the garment's middle (clear of collars, waistbands, hems and shoes).
  const [from, to] = [bandTop + 0.2 * bandSpan, bandTop + 0.75 * bandSpan];
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const y = Math.floor(i / width);
    if (candidates[i] && y >= from && y <= to) {
      seed[i] = 1;
      reds.push(data[i * 4]);
      greens.push(data[i * 4 + 1]);
      blues.push(data[i * 4 + 2]);
    }
  }
  const seedRgb: [number, number, number] = [median(reds), median(greens), median(blues)];
  const seedLum = Math.max(8, luminance(...seedRgb));
  const seedSum = Math.max(1, seedRgb[0] + seedRgb[1] + seedRgb[2]);
  const seedChroma = seedRgb.map((c) => c / seedSum);

  // The garment's clothes pixels in its band: same chroma, deep shadows allowed,
  // nothing far brighter (white sneakers under black joggers).
  const grown = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    const y = Math.floor(i / width);
    if (!candidates[i] || y < bandTop || y > bandBottom) {
      continue;
    }
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const sum = Math.max(1, r + g + b);
    const chroma = Math.hypot(r / sum - seedChroma[0], g / sum - seedChroma[1], b / sum - seedChroma[2]);
    const ratio = Math.max(4, luminance(r, g, b)) / seedLum;
    grown[i] = chroma < 0.08 && ratio > 0.12 && ratio < 4 ? 1 : 0;
  }
  const region = fillHoles(keepSeededComponent(grown, seed, width, height), width, height);
  const seen = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    // Inside the outline, the photo shows the garment where it shows clothes
    // (a print is clothes; a hand or a bag is not). A product shot shows all of it.
    seen[i] = region[i] && (productShot || candidates[i]) ? 1 : 0;
  }
  return { region, seen, seedRgb: [seedRgb[0] / 255, seedRgb[1] / 255, seedRgb[2] / 255], productShot };
}

/** Light removed: each pixel divided by the garment's smooth shading around it, times the garment's median brightness. */
export function delight(image: RgbaImage, seen: Uint8Array, radius: number): Float32Array {
  const { width, height, data } = image;
  const n = width * height;
  const lum = new Float32Array(n);
  const weights = new Float32Array(n);
  const levels: number[] = [];
  for (let i = 0; i < n; i += 1) {
    lum[i] = luminance(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) / 255;
    weights[i] = seen[i];
    if (seen[i] && i % 7 === 0) {
      levels.push(lum[i]);
    }
  }
  const shading = maskedBlur(lum, weights, width, height, radius);
  const level = Math.max(0.03, median(levels));
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    // Only the broad light comes out; seams and folds keep their own shading
    // (dividing them out turned every seam shadow into a bright ridge).
    const gain = shading[i] > 0.01 ? Math.min(MAX_DELIGHT_GAIN, Math.max(1 / MAX_DELIGHT_GAIN, level / shading[i])) : 1;
    for (let c = 0; c < 3; c += 1) {
      out[i * 3 + c] = Math.min(1, (data[i * 4 + c] / 255) * gain);
    }
  }
  return out;
}

/**
 * The cleanest square patch fully inside the seen garment, made seamless
 * (blended with a half-offset copy of itself so its edges wrap).
 */
export function fabricTile(delit: Float32Array, seen: Uint8Array, width: number, height: number, size: number): RgbaImage | null {
  const s = Math.max(8, Math.floor(size));
  if (s >= width || s >= height) {
    return null;
  }
  // Integral image of "not seen" to test windows fully inside the garment.
  const holes = new Float64Array((width + 1) * (height + 1));
  const lum = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      row += seen[i] ? 0 : 1;
      holes[(y + 1) * (width + 1) + x + 1] = holes[y * (width + 1) + x + 1] + row;
      lum[i] = luminance(delit[i * 3], delit[i * 3 + 1], delit[i * 3 + 2]);
    }
  }
  const emptyIn = (x: number, y: number): number =>
    holes[(y + s) * (width + 1) + x + s] - holes[y * (width + 1) + x + s] - holes[(y + s) * (width + 1) + x] + holes[y * (width + 1) + x];
  // Mid-scale structure (seams, buttons, pocket edges) makes a patch unclean.
  const ones = new Float32Array(width * height).fill(1);
  const mid = maskedBlur(lum, ones, width, height, Math.max(1, Math.floor(s / 8)));
  let best: [number, number] | null = null;
  let bestScore = Infinity;
  const step = Math.max(2, Math.floor(s / 6));
  for (let y = 0; y + s <= height; y += step) {
    for (let x = 0; x + s <= width; x += step) {
      if (emptyIn(x, y) > 0) {
        continue;
      }
      let sum = 0;
      let sumSq = 0;
      let count = 0;
      for (let yy = y; yy < y + s; yy += 2) {
        for (let xx = x; xx < x + s; xx += 2) {
          const v = mid[yy * width + xx];
          sum += v;
          sumSq += v * v;
          count += 1;
        }
      }
      const variance = sumSq / count - (sum / count) ** 2;
      if (variance < bestScore) {
        bestScore = variance;
        best = [x, y];
      }
    }
  }
  if (!best) {
    return null;
  }
  const [x0, y0] = best;
  const out = new Uint8ClampedArray(s * s * 4);
  const half = Math.floor(s / 2);
  const weight = (i: number): number => Math.min(i + 0.5, s - i - 0.5) / (s / 2);
  for (let y = 0; y < s; y += 1) {
    for (let x = 0; x < s; x += 1) {
      const w1 = weight(x) * weight(y);
      const sx = (x + half) % s;
      const sy = (y + half) % s;
      const w2 = weight(sx) * weight(sy);
      const a = ((y0 + y) * width + x0 + x) * 3;
      const b = ((y0 + sy) * width + x0 + sx) * 3;
      for (let c = 0; c < 3; c += 1) {
        out[(y * s + x) * 4 + c] = Math.round(((delit[a + c] * w1 + delit[b + c] * w2) / Math.max(1e-6, w1 + w2)) * 255);
      }
      out[(y * s + x) * 4 + 3] = 255;
    }
  }
  return { width: s, height: s, data: out };
}

/** Typical garment width in px (median row width over the garment's middle). */
function typicalWidth(rows: Int32Array): number {
  const widths: number[] = [];
  const count = rows.length / 2;
  for (let y = Math.floor(count * 0.35); y < Math.floor(count * 0.85); y += 1) {
    if (rows[y * 2] >= 0) {
      widths.push(rows[y * 2 + 1] - rows[y * 2]);
    }
  }
  return median(widths);
}

/** The garment's front: its bounding box, light removed, alpha = seen; row edges capped near the typical width. */
export function frontMap(delit: Float32Array, region: Uint8Array, seen: Uint8Array, width: number, height: number): { front: RgbaImage; rows: Int32Array } | null {
  let x0 = width;
  let x1 = -1;
  let y0 = height;
  let y1 = -1;
  for (let i = 0; i < region.length; i += 1) {
    if (region[i]) {
      const x = i % width;
      const y = Math.floor(i / width);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) {
    return null;
  }
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const data = new Uint8ClampedArray(w * h * 4);
  const rows = new Int32Array(h * 2).fill(-1);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y0 + y) * width + x0 + x;
      const o = (y * w + x) * 4;
      data[o] = Math.round(delit[i * 3] * 255);
      data[o + 1] = Math.round(delit[i * 3 + 1] * 255);
      data[o + 2] = Math.round(delit[i * 3 + 2] * 255);
      data[o + 3] = seen[i] ? 255 : 0;
      if (region[i]) {
        if (rows[y * 2] < 0) {
          rows[y * 2] = x;
        }
        rows[y * 2 + 1] = x;
      }
    }
  }
  // Sleeves on a model's arms widen the top rows: keep the body's width there.
  const typical = typicalWidth(rows);
  for (let y = 0; y < h; y += 1) {
    const left = rows[y * 2];
    const right = rows[y * 2 + 1];
    if (left >= 0 && right - left > typical * ROW_WIDTH_CAP) {
      const centre = (left + right) / 2;
      rows[y * 2] = Math.round(centre - (typical * ROW_WIDTH_CAP) / 2);
      rows[y * 2 + 1] = Math.round(centre + (typical * ROW_WIDTH_CAP) / 2);
    }
  }
  return { front: { width: w, height: h, data }, rows };
}

/** Whether the photo shows the garment's whole front cleanly enough to carry its details over. */
export function frontMetrics(
  region: Uint8Array,
  seen: Uint8Array,
  front: RgbaImage,
  width: number,
): { seenShare: number; solidity: number; aspect: number; ragged: number; twoLegs: number } {
  let regionArea = 0;
  let seenArea = 0;
  let edge = 0;
  for (let i = 0; i < region.length; i += 1) {
    regionArea += region[i];
    seenArea += seen[i];
    if (region[i]) {
      const x = i % width;
      const outside = (x > 0 && !region[i - 1]) || (x < width - 1 && !region[i + 1])
        || (i >= width && !region[i - width]) || (i + width < region.length && !region[i + width]);
      edge += outside ? 1 : 0;
    }
  }
  // Outline length against a rectangle of the same box: 1 for a clean shape,
  // higher when hair, hands or shadows eat into the outline.
  const box = 2 * (front.width + front.height);
  // Rows of the lower half with a gap between two runs of garment.
  let rows = 0;
  let twoRuns = 0;
  for (let y = Math.floor(front.height / 2); y < front.height; y += 1) {
    let runs = 0;
    let inside = false;
    for (let x = 0; x < front.width; x += 1) {
      const on = front.data[(y * front.width + x) * 4 + 3] > 0;
      if (on && !inside) {
        runs += 1;
      }
      inside = on;
    }
    rows += 1;
    twoRuns += runs >= 2 ? 1 : 0;
  }
  return {
    seenShare: seenArea / Math.max(1, regionArea),
    solidity: regionArea / Math.max(1, front.width * front.height),
    aspect: front.height / Math.max(1, front.width),
    ragged: edge / Math.max(1, box),
    twoLegs: twoRuns / Math.max(1, rows),
  };
}

export function frontUsable(
  region: Uint8Array,
  seen: Uint8Array,
  front: RgbaImage,
  width: number,
  category: GarmentCategory | null,
): boolean {
  const kind = category === null || TOP_CATEGORIES.has(category) ? 'top' : 'bottom';
  const { seenShare, solidity, aspect, ragged, twoLegs } = frontMetrics(region, seen, front, width);
  return (
    seenShare >= MIN_FRONT_SEEN
    && solidity >= MIN_FRONT_SOLIDITY[kind]
    && aspect >= FRONT_ASPECT[kind][0]
    && aspect <= FRONT_ASPECT[kind][1]
    && ragged <= MAX_FRONT_RAGGED
    && (kind === 'top' || twoLegs >= MIN_TWO_LEG_ROWS)
  );
}

/**
 * Keep only the garment's own details on its front: prints, embroidery,
 * buttons, logos, patches (pixels that differ from the plain fabric around
 * them in colour, or strongly in brightness). The photo's folds and
 * highlights go: the physics draws this shopper's own (in place, alpha).
 */
export function keepDetails(front: RgbaImage, garmentPx: number): void {
  const { width, height, data } = front;
  const n = width * height;
  const seenWeight = new Float32Array(n);
  const channels = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i += 1) {
    seenWeight[i] = data[i * 4 + 3] > 0 ? 1 : 0;
    for (let c = 0; c < 3; c += 1) {
      channels[c][i] = data[i * 4 + c] / 255;
    }
  }
  const radius = Math.max(3, Math.round(garmentPx * DETAIL_BASE_RADIUS_SHARE));
  const base = channels.map((channel) => maskedBlur(channel, seenWeight, width, height, radius));
  const detail = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    if (!seenWeight[i]) {
      continue;
    }
    const r = channels[0][i];
    const g = channels[1][i];
    const b = channels[2][i];
    const br = base[0][i];
    const bg = base[1][i];
    const bb = base[2][i];
    const sum = Math.max(0.03, r + g + b);
    const baseSum = Math.max(0.03, br + bg + bb);
    const chroma = Math.hypot(r / sum - br / baseSum, g / sum - bg / baseSum, b / sum - bb / baseSum);
    const contrast = Math.abs(Math.log(Math.max(0.02, luminance(r, g, b)) / Math.max(0.02, luminance(br, bg, bb))));
    const byColour = (chroma - DETAIL_CHROMA[0]) / (DETAIL_CHROMA[1] - DETAIL_CHROMA[0]);
    const byBrightness = (contrast - DETAIL_CONTRAST[0]) / (DETAIL_CONTRAST[1] - DETAIL_CONTRAST[0]);
    detail[i] = Math.min(1, Math.max(0, byColour, byBrightness));
  }
  // Soft edges: a detail fades into the fabric over a pixel or two.
  const soft = maskedBlur(detail, new Float32Array(n).fill(1), width, height, 1);
  for (let i = 0; i < n; i += 1) {
    data[i * 4 + 3] = Math.round(seenWeight[i] * Math.min(1, soft[i] * 1.5) * 255);
  }
}

/**
 * Everything the mirror view needs from one product photo. `garmentWidthCm`:
 * the photographed garment's flat width (chest / 2 for a top, hip / 2 for a
 * bottom, from the size chart's middle size) to size the fabric.
 */
export function extractGarmentLook(
  image: RgbaImage,
  clothes: Float32Array | null,
  category: GarmentCategory | null,
  garmentWidthCm: number,
): GarmentLook | null {
  const { width, height } = image;
  const { region, seen, seedRgb, productShot } = findGarment(image, clothes, category);
  let area = 0;
  for (let i = 0; i < seen.length; i += 1) {
    area += seen[i];
  }
  if (area < width * height * 0.01) {
    return null;
  }
  const front0 = frontMap(new Float32Array(width * height * 3), region, seen, width, height);
  if (!front0) {
    return null;
  }
  const garmentPx = Math.max(8, typicalWidth(front0.rows));
  const delit = delight(image, seen, Math.max(4, Math.round(garmentPx * DELIGHT_RADIUS_SHARE)));
  const mapped = frontMap(delit, region, seen, width, height);
  const fabric = fabricTile(delit, seen, width, height, garmentPx * PATCH_SHARE);
  if (!mapped || !fabric) {
    return null;
  }
  const metresPerPx = garmentWidthCm / 100 / garmentPx;
  // On a model, her necklace, hair and the photo's deep folds pass as prints
  // (owner's try-on, 2026-10-23: a gold chain on the shopper's chest), so the
  // details come only from a product shot; a model photo gives fabric and colour.
  const usable = clothes !== null && productShot && frontUsable(region, seen, mapped.front, width, category);
  if (usable) {
    keepDetails(mapped.front, garmentPx);
  }
  return {
    meanRgb: seedRgb,
    fabric,
    fabricMetres: fabric.width * metresPerPx,
    front: usable ? mapped.front : null,
    frontRows: usable ? mapped.rows : null,
  };
}
