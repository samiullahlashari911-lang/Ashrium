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
