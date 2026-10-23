import { FILL_ZONE, pushPullFill } from '@/lib/graphics/clothes-removal';
import { squareFilter } from '@/lib/graphics/mask-filter';

/**
 * Narrow gaps in the drawn garment, closed (on this device). Seen from the
 * front, a crewneck shows the inside of its back collar over each shoulder,
 * beside the neck; drawn from the drape, that band comes out as a few
 * jagged teeth with the wall between them, and the clothes removal then
 * paints wall colour into the gap. A morphological closing of the garment's
 * coverage (dilate, then erode, by `radius`) fills such gaps where the caller
 * allows it, coloured from the nearest garment pixels and darkened by `shade`
 * like fabric seen from inside. Openings wider than 2 × `radius` (the
 * neckline itself, the space between the legs) stay open.
 */
export interface GarmentGapInput {
  width: number;
  height: number;
  /** The drawn garment layer (RGBA, alpha = coverage); gaps are filled in place. */
  rgba: Uint8ClampedArray;
  /** 1 where a gap may be filled. */
  allowed: Uint8Array;
  /** Pixels. */
  radius: number;
  /** Brightness of the filled inside fabric relative to the garment beside it. */
  shade: number;
  /**
   * Old-clothes confidence (0-1) per pixel: in the allowed band, where the
   * shopper's own collar stood beside the neck the new collar covers it too,
   * instead of the wall showing through where the old one is taken out.
   */
  oldClothes?: Float32Array;
}

/** Old-collar pixels at or above this confidence are covered by the new collar. */
const OLD_COLLAR_SURE = 0.5;

/** Fills the gaps in place; returns how many pixels were added. */
export function closeGarmentGaps(input: GarmentGapInput): number {
  const { width, height, rgba, allowed, radius, shade, oldClothes } = input;
  const count = width * height;
  const mask = new Uint8Array(count);
  for (let pixel = 0; pixel < count; pixel += 1) {
    mask[pixel] = rgba[pixel * 4 + 3] >= 128 ? 1 : 0;
  }
  const closed = squareFilter(squareFilter(mask, width, height, radius, true), width, height, radius, false);
  const added: number[] = [];
  for (let pixel = 0; pixel < count; pixel += 1) {
    const oldCollar = oldClothes !== undefined && oldClothes[pixel] >= OLD_COLLAR_SURE;
    if ((closed[pixel] || oldCollar) && !mask[pixel] && allowed[pixel]) {
      added.push(pixel);
    }
  }
  if (added.length === 0) {
    return 0;
  }
  const values = new Float32Array(count * 3);
  const weight = new Float32Array(count);
  for (let pixel = 0; pixel < count; pixel += 1) {
    if (mask[pixel]) {
      weight[pixel] = 1;
      values[pixel * 3] = rgba[pixel * 4];
      values[pixel * 3 + 1] = rgba[pixel * 4 + 1];
      values[pixel * 3 + 2] = rgba[pixel * 4 + 2];
    }
  }
  const filled = pushPullFill(width, height, values, weight);
  for (const pixel of added) {
    rgba[pixel * 4] = filled[pixel * 3] * shade;
    rgba[pixel * 4 + 1] = filled[pixel * 3 + 1] * shade;
    rgba[pixel * 4 + 2] = filled[pixel * 3 + 2] * shade;
    rgba[pixel * 4 + 3] = 255;
  }
  return added.length;
}

/**
 * Thin spikes of the drawn garment beside the neck, taken out (on this
 * device). Projected from the drape, the back collar band can poke up over
 * each shoulder as a narrow post that no fabric under gravity would hold; a
 * morphological opening (erode, then dilate, by `radius`) inside `allowed`
 * removes what is narrower than 2 × `radius` and keeps the garment's body.
 * The clothes removal then fills behind with neck skin or wall.
 */
export function trimGarmentSpikes(input: Omit<GarmentGapInput, 'shade' | 'oldClothes'>): number {
  const { width, height, rgba, allowed, radius } = input;
  const count = width * height;
  const mask = new Uint8Array(count);
  for (let pixel = 0; pixel < count; pixel += 1) {
    mask[pixel] = rgba[pixel * 4 + 3] >= 128 ? 1 : 0;
  }
  const opened = squareFilter(squareFilter(mask, width, height, radius, false), width, height, radius, true);
  let removed = 0;
  for (let pixel = 0; pixel < count; pixel += 1) {
    if (allowed[pixel] && rgba[pixel * 4 + 3] > 0 && !opened[pixel]) {
      rgba[pixel * 4 + 3] = 0;
      removed += 1;
    }
  }
  return removed;
}

/**
 * Where a collar gap may be filled: off the fitted body (`FILL_ZONE.outside`)
 * within `reach` pixels of the head (`head`: the fitted head only, never the
 * hands). Never on the face or the body.
 */
export function collarGapBand(zone: Uint8Array, head: Uint8Array, width: number, height: number, reach: number): Uint8Array {
  const near = squareFilter(head, width, height, Math.max(1, Math.round(reach)), true);
  return near.map((value, pixel) => (value && zone[pixel] === FILL_ZONE.outside ? 1 : 0));
}
