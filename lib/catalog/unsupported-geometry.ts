import type { GarmentCategory, GarmentFiberComposition } from '@/types/garment';

export interface UnsupportedGeometryInput {
  category: GarmentCategory;
  title: string;
  tags?: readonly string[];
  description?: string;
  composition?: GarmentFiberComposition | null;
}

const HOOD = /\b(hood|hoodie|hooded)\b/i;
const LAPEL = /\b(lapel|blazer|suit\s+jacket|notch\s+collar|double[-\s]?breasted)\b/i;
// An open-front knit drawn as a closed top would misstate the garment. Cargo
// trousers sew as plain trousers (owner, 2026-10-10). Long sleeves (pullovers
// included) tear at the cap in the drape grid, so they stay off until they drape.
const CARDIGAN = /\b(cardigans?)\b/i;
const LONG_SLEEVE =
  /\b(long[-\s]?sleeves?|full[-\s]?sleeves?|sweaters?|jumpers?|pullovers?|sweatshirts?|quarter[-\s]?zip)\b/i;
const JUMPSUIT = /\b(jumpsuit|romper|overall)\b/i;
// Title only: descriptions say "set-in sleeves" or a dress's "flowy skirt".
const SKIRT_TITLE = /\b(skirt|skort)s?\b/i;
const SET_TITLE = /\b(set|two[-\s]?piece|2[-\s]?piece)\b/i;

function corpus(input: UnsupportedGeometryInput): string {
  const fibers = input.composition ? Object.keys(input.composition).join(' ') : '';
  return [input.title, ...(input.tags ?? []), input.description ?? '', fibers]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Hoods, lapels, cardigans, long sleeves, jumpsuits, skirts, and multi-piece
 * sets have no 3D GarmentCode path in v1. Tees and cargo trousers are allowed.
 */
export function detectUnsupportedGeometry(input: UnsupportedGeometryInput): string | null {
  if (input.category === 'other') {
    return 'unsupported category';
  }
  if (SET_TITLE.test(input.title)) {
    return 'multi-piece set';
  }
  // Skirts are filed under bottoms; grading one as trousers would drape legs.
  if (input.category === 'pant' && SKIRT_TITLE.test(input.title)) {
    return 'skirt';
  }

  const text = corpus(input);
  if (HOOD.test(text)) {
    return 'hood';
  }
  if (LAPEL.test(text)) {
    return 'lapel';
  }
  if (CARDIGAN.test(text)) {
    return 'knit';
  }
  if (input.category === 'outerwear' || LONG_SLEEVE.test(text)) {
    return 'long sleeve';
  }
  if (JUMPSUIT.test(text)) {
    return 'jumpsuit';
  }

  return null;
}
