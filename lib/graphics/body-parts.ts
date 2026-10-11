import { FILL_ZONE, type ReplacedClothes } from '@/lib/graphics/clothes-removal';
import type { GarmentCategory } from '@/types/garment';
import { MHR_VERTEX_COUNT } from '@/types/hmr';

/**
 * Per-vertex body part labels for MHR LOD 1, generated offline by
 * `gpu/tools/build_body_parts.py` (values must match it). Used to fill skin
 * where a tried garment replaces what the shopper wore in the photo.
 */
export const MHR_PARTS_PUBLIC_PATH = '/models/mhr-parts.bin';

export const BODY_PART = {
  head: 0,
  upperTorso: 1,
  lowerTorsoLegs: 2,
  arm: 3,
  hand: 4,
  foot: 5,
} as const;

type BodyPart = (typeof BODY_PART)[keyof typeof BODY_PART];

/**
 * What a garment replaces. A top replaces the shopper's top (torso + arms), a
 * bottom their bottom; outerwear goes over their own clothes, so it replaces
 * nothing. Head, hands and feet always keep the photo.
 */
export function replacedParts(category: GarmentCategory | null | undefined): ReadonlySet<BodyPart> {
  switch (category) {
    case 'tee':
      return new Set([BODY_PART.upperTorso, BODY_PART.arm]);
    case 'pant':
      return new Set([BODY_PART.lowerTorsoLegs]);
    case 'dress':
      return new Set([BODY_PART.upperTorso, BODY_PART.arm, BODY_PART.lowerTorsoLegs]);
    default:
      return new Set();
  }
}

/** 1 where skin replaces the shopper's own clothes for this garment, else 0. */
export function skinFillMask(labels: Uint8Array, category: GarmentCategory | null | undefined): Float32Array {
  const parts = replacedParts(category);
  const mask = new Float32Array(labels.length);
  for (let i = 0; i < labels.length; i += 1) {
    mask[i] = parts.has(labels[i] as BodyPart) ? 1 : 0;
  }
  return mask;
}

export function readBodyParts(buffer: ArrayBuffer): Uint8Array {
  const labels = new Uint8Array(buffer);
  if (labels.length !== MHR_VERTEX_COUNT || labels.some((label) => label > BODY_PART.foot)) {
    throw new Error(`mhr-parts.bin must hold ${MHR_VERTEX_COUNT} labels 0-${BODY_PART.foot}.`);
  }
  return labels;
}

export async function loadBodyParts(): Promise<Uint8Array> {
  const response = await fetch(MHR_PARTS_PUBLIC_PATH);
  if (!response.ok) {
    throw new Error(`Body part labels failed to load (${response.status}).`);
  }
  return readBodyParts(await response.arrayBuffer());
}

/** Old clothes a garment replaces in the shopper's photo (`lib/graphics/clothes-removal.ts`). */
export function replacedClothes(category: GarmentCategory | null | undefined): ReplacedClothes | null {
  switch (category) {
    case 'tee':
      return 'top';
    case 'pant':
      return 'bottom';
    case 'dress':
      return 'both';
    default:
      return null;
  }
}

/** Canonical heights as a fraction of stature above the floor (natural waist matches `build_body_parts.py`). */
const NATURAL_WAIST_FRACTION = 0.615;
/** A mid-rise trouser waistband sits a little below the natural waist. */
const WAISTBAND_FRACTION = 0.575;
const CROTCH_FRACTION = 0.47;

export interface BodyHeights {
  naturalWaistY: number;
  waistbandY: number;
  crotchY: number;
}

/** Natural waist, trouser waistband and crotch heights on a canonical body (metres, y up). */
export function bodyHeights(positions: Float32Array): BodyHeights {
  let floor = Infinity;
  let top = -Infinity;
  for (let i = 1; i < positions.length; i += 3) {
    floor = Math.min(floor, positions[i]);
    top = Math.max(top, positions[i]);
  }
  const stature = top - floor;
  return {
    naturalWaistY: floor + NATURAL_WAIST_FRACTION * stature,
    waistbandY: floor + WAISTBAND_FRACTION * stature,
    crotchY: floor + CROTCH_FRACTION * stature,
  };
}

/** Chin below the nose tip on an adult (matches `build_body_parts.py`). */
const CHIN_BELOW_NOSE_M = 0.085;

/**
 * `FILL_ZONE` per body vertex: what fills where an old garment is taken out.
 * The face and hair (head above the chin) and the feet keep the photo; the
 * upper neck and the hands may lose a collar or a cuff, never skin (only
 * clothes pixels are ever filled).
 */
export function vertexFillZones(positions: Float32Array, labels: Uint8Array): Uint8Array {
  const { waistbandY } = bodyHeights(positions);
  let noseZ = -Infinity;
  let noseY = Infinity;
  for (let i = 0; i < labels.length; i += 1) {
    if (labels[i] === BODY_PART.head && Math.abs(positions[i * 3]) < 0.015 && positions[i * 3 + 2] > noseZ) {
      noseZ = positions[i * 3 + 2];
      noseY = positions[i * 3 + 1];
    }
  }
  const chinY = Number.isFinite(noseY) ? noseY - CHIN_BELOW_NOSE_M : -Infinity;
  const zones = new Uint8Array(labels.length);
  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i];
    const y = positions[i * 3 + 1];
    zones[i] =
      label === BODY_PART.foot || (label === BODY_PART.head && y >= chinY)
        ? FILL_ZONE.keep
        : label === BODY_PART.lowerTorsoLegs && y < waistbandY
          ? FILL_ZONE.lower
          : FILL_ZONE.upper;
  }
  return zones;
}
