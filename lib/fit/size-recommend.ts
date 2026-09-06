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
};

type GirthKey = 'chestCm' | 'waistCm' | 'hipCm';

function easeFor(category: GarmentCategory | null): CategoryEaseCm {
  return CATEGORY_EASE_CM[category ?? 'other'];
}

function primaryGirths(category: GarmentCategory | null): readonly GirthKey[] {
  switch (category) {
    case 'pant':
      return ['waistCm', 'hipCm'];
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
    EXTRASMALL: 'XS',
    XSMALL: 'XS',
  };

  return aliases[compact] ?? compact;
}

function sizeRank(sizeCode: string): number {
  return SIZE_RANK[normalizeSizeCode(sizeCode)] ?? Number.POSITIVE_INFINITY;
}

function variantFits(
  variant: StorefrontSizeVariant,
  needed: Record<GirthKey, number>,
  category: GarmentCategory | null,
): boolean {
  return primaryGirths(category).every((key) => variant[key] + 1e-6 >= needed[key]);
}

function toRecommendation(
  variant: StorefrontSizeVariant,
  source: SizeRecommendation['source'],
): SizeRecommendation {
  return {
    sizeCode: variant.sizeCode,
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
): SizeRecommendation {
  const ordered = [...variants].sort((left, right) => {
    const rankDelta = sizeRank(left.sizeCode) - sizeRank(right.sizeCode);
    if (Number.isFinite(rankDelta) && rankDelta !== 0) {
      return rankDelta;
    }

    return left.chestCm - right.chestCm;
  });

  const fitting = ordered.find((variant) => variantFits(variant, needed, category));
  return toRecommendation(fitting ?? ordered[ordered.length - 1], source);
}

/**
 * Maps derived ANNY girths plus category wearing ease onto S/M/L/XL
 * (or the merchant's size_code when variants exist).
 */
export function recommendSize(
  measurements: AnnyDerivedMeasurements,
  category: GarmentCategory | null,
  variants: readonly StorefrontSizeVariant[],
): SizeRecommendation {
  const needed = neededGirths(measurements, category);
  if (variants.length > 0) {
    return pickSmallestFitting(variants, needed, category, 'variant');
  }

  return pickSmallestFitting(DEFAULT_LETTER_SIZE_CHART, needed, category, 'ease_chart');
}

export function categoryEase(category: GarmentCategory | null): CategoryEaseCm {
  return easeFor(category);
}

export function garmentKindFromCategory(
  category: GarmentCategory | null,
): 'tee' | 'pant' | 'dress' {
  if (category === 'pant') {
    return 'pant';
  }

  if (category === 'dress') {
    return 'dress';
  }

  return 'tee';
}
