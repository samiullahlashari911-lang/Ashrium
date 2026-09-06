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
const CARGO = /\b(cargo)\b/i;
const KNIT =
  /\b(sweater|jumper|cardigan|knitwear|cable[-\s]?knit|ribbed\s+knit|wool\s+knit|merino\s+knit)\b/i;
const JUMPSUIT = /\b(jumpsuit|romper|overall)\b/i;

function corpus(input: UnsupportedGeometryInput): string {
  const fibers = input.composition ? Object.keys(input.composition).join(' ') : '';
  return [input.title, ...(input.tags ?? []), input.description ?? '', fibers]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Hoods, lapels, cargo, and knitwear have no 3D GarmentCode path in v1.
 * Jersey tees are allowed; sweater/cardigan/knitwear are not.
 */
export function detectUnsupportedGeometry(input: UnsupportedGeometryInput): string | null {
  if (input.category === 'other') {
    return 'unsupported category';
  }

  const text = corpus(input);
  if (HOOD.test(text)) {
    return 'hood';
  }
  if (LAPEL.test(text)) {
    return 'lapel';
  }
  if (CARGO.test(text)) {
    return 'cargo';
  }
  if (KNIT.test(text)) {
    return 'knit';
  }
  if (JUMPSUIT.test(text)) {
    return 'jumpsuit';
  }

  return null;
}
