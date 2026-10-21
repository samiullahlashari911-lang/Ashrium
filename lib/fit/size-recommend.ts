import type { AnnyDerivedMeasurements } from '@/types/hmr';
import type {
  CategoryEaseCm,
  GarmentCategory,
  SizeRecommendation,
  StorefrontSizeVariant,
} from '@/types/garment';

/** Wearing ease (cm) added to body girths before comparing to garment measurements. */
export const CATEGORY_EASE_CM: Record<GarmentCategory, CategoryEaseCm> = {
  tee: { chestCm: 8, waistCm: 6, hipCm: 6 },
  pant: { chestCm: 4, waistCm: 2, hipCm: 4 },
  dress: { chestCm: 6, waistCm: 4, hipCm: 6 },
  outerwear: { chestCm: 12, waistCm: 10, hipCm: 10 },
  other: { chestCm: 6, waistCm: 4, hipCm: 6 },
};

/**
 * How far (cm) the photo measurement moves between two captures of the same
 * person (live jobs f56fa1bb / 7377ef9b: chest 96.3 vs 97.0, same photos). A
 * size within this of the wearing-ease target still fits, so noise alone never
 * pushes a shopper up a size; a body this close to a size boundary is told it
 * is between sizes instead of being given one size as if it were certain.
 */
export const SIZE_TOLERANCE_CM = 1;

export const DEFAULT_LETTER_SIZE_CHART: readonly StorefrontSizeVariant[] = [
  { id: null, sizeCode: 'S', chestCm: 96, waistCm: 80, hipCm: 96, lengthCm: 68 },
  { id: null, sizeCode: 'M', chestCm: 104, waistCm: 88, hipCm: 104, lengthCm: 70 },
  { id: null, sizeCode: 'L', chestCm: 112, waistCm: 96, hipCm: 112, lengthCm: 72 },
  { id: null, sizeCode: 'XL', chestCm: 120, waistCm: 104, hipCm: 120, lengthCm: 74 },
];

const SIZE_RANK: Record<string, number> = {
  XXS: 0,
  XS: 1,
  S: 2,
  M: 3,
  L: 4,
  XL: 5,
  XXL: 6,
  XXXL: 7,
  '4XL': 8,
  '5XL': 9,
  '6XL': 10,
  '7XL': 11,
};

type GirthKey = 'chestCm' | 'waistCm' | 'hipCm';

function easeFor(category: GarmentCategory | null): CategoryEaseCm {
  return CATEGORY_EASE_CM[category ?? 'other'];
}

function primaryGirths(category: GarmentCategory | null, elasticWaist = false): readonly GirthKey[] {
  switch (category) {
    case 'pant':
      // A relaxed elastic waist stretches over the body: the seat decides.
      return elasticWaist ? ['hipCm'] : ['waistCm', 'hipCm'];
    case 'tee':
    case 'outerwear':
      return ['chestCm', 'waistCm'];
    default:
      return ['chestCm', 'waistCm', 'hipCm'];
  }
}

function neededGirths(
  measurements: AnnyDerivedMeasurements,
  category: GarmentCategory | null,
): Record<GirthKey, number> {
  const ease = easeFor(category);
  return {
    chestCm: measurements.chest_cm + ease.chestCm,
    waistCm: measurements.waist_cm + ease.waistCm,
    hipCm: measurements.hip_cm + ease.hipCm,
  };
}

export function normalizeSizeCode(sizeCode: string): string {
  const compact = sizeCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const aliases: Record<string, string> = {
    SMALL: 'S',
    MEDIUM: 'M',
    LARGE: 'L',
    EXTRALARGE: 'XL',
    XLARGE: 'XL',
    XXLARGE: 'XXL',
    '2XL': 'XXL',
    '3XL': 'XXXL',
    '4XL': '4XL',
    XXXXL: '4XL',
    '5XL': '5XL',
    XXXXXL: '5XL',
    '6XL': '6XL',
    '7XL': '7XL',
    EXTRASMALL: 'XS',
    XSMALL: 'XS',
    ONESIZE: 'OS',
  };

  return aliases[compact] ?? compact;
}

function sizeRank(sizeCode: string): number {
  const normalized = normalizeSizeCode(sizeCode);
  if (Object.prototype.hasOwnProperty.call(SIZE_RANK, normalized)) {
    return SIZE_RANK[normalized] ?? Number.POSITIVE_INFINITY;
  }

  if (/^\d{1,2}$/.test(normalized)) {
    return Number(normalized);
  }

  return Number.POSITIVE_INFINITY;
}

function variantFits(
  variant: StorefrontSizeVariant,
  needed: Record<GirthKey, number>,
  category: GarmentCategory | null,
  elasticWaist: boolean,
): boolean {
  return primaryGirths(category, elasticWaist).every((key) => {
    const published = variant[key];
    if (!published || published <= 0) {
      return true;
    }

    return published + SIZE_TOLERANCE_CM + 1e-6 >= needed[key];
  });
}

/** Smallest room left over the needed girths (cm, negative = short of the ease target). */
function fitMargin(
  variant: StorefrontSizeVariant,
  needed: Record<GirthKey, number>,
  category: GarmentCategory | null,
  elasticWaist: boolean,
): number {
  const margins = primaryGirths(category, elasticWaist)
    .filter((key) => variant[key] > 0)
    .map((key) => variant[key] - needed[key]);
  return margins.length > 0 ? Math.min(...margins) : Infinity;
}

function toRecommendation(
  variant: StorefrontSizeVariant,
  source: SizeRecommendation['source'],
  fits: boolean,
  betweenSizeCode: string | null = null,
): SizeRecommendation {
  return {
    sizeCode: variant.sizeCode,
    fits,
    betweenSizeCode,
    source,
    variantId: variant.id,
    chestCm: variant.chestCm,
    waistCm: variant.waistCm,
    hipCm: variant.hipCm,
    lengthCm: variant.lengthCm,
  };
}

function pickSmallestFitting(
  variants: readonly StorefrontSizeVariant[],
  needed: Record<GirthKey, number>,
  category: GarmentCategory | null,
  source: SizeRecommendation['source'],
  elasticWaist: boolean,
): SizeRecommendation {
  const ordered = [...variants].sort((left, right) => {
    const rankDelta = sizeRank(left.sizeCode) - sizeRank(right.sizeCode);
    if (Number.isFinite(rankDelta) && rankDelta !== 0) {
      return rankDelta;
    }

    return left.chestCm - right.chestCm;
  });

  const index = ordered.findIndex((variant) => variantFits(variant, needed, category, elasticWaist));
  if (index < 0) {
    return toRecommendation(ordered[ordered.length - 1], source, false);
  }
  const fitting = ordered[index];
  const larger = ordered[index + 1];
  const close = fitMargin(fitting, needed, category, elasticWaist) < SIZE_TOLERANCE_CM;
  return toRecommendation(fitting, source, true, close && larger ? larger.sizeCode : null);
}

/**
 * Maps derived ANNY girths plus category wearing ease onto S/M/L/XL
 * (or the merchant's size_code when variants exist).
 */
export function recommendSize(
  measurements: AnnyDerivedMeasurements,
  category: GarmentCategory | null,
  variants: readonly StorefrontSizeVariant[],
  options: { elasticWaist?: boolean } = {},
): SizeRecommendation {
  const needed = neededGirths(measurements, category);
  const elasticWaist = options.elasticWaist ?? false;
  if (variants.length > 0) {
    return pickSmallestFitting(variants, needed, category, 'variant', elasticWaist);
  }

  return pickSmallestFitting(DEFAULT_LETTER_SIZE_CHART, needed, category, 'ease_chart', elasticWaist);
}

export function categoryEase(category: GarmentCategory | null): CategoryEaseCm {
  return easeFor(category);
}
