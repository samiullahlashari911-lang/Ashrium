export type WeightUnit = 'kg' | 'lb';

export const WEIGHT_KG_MIN = 30;
export const WEIGHT_KG_MAX = 250;
export const WEIGHT_KG_DEFAULT = 70;

const KG_PER_LB = 0.45359237;

export function clampWeightKg(value: number): number {
  if (!Number.isFinite(value)) {
    return WEIGHT_KG_DEFAULT;
  }
  return Math.min(WEIGHT_KG_MAX, Math.max(WEIGHT_KG_MIN, Math.round(value * 10) / 10));
}

export function lbToKg(pounds: number): number {
  return clampWeightKg(pounds * KG_PER_LB);
}

export function kgToLb(kilograms: number): number {
  return Math.round(clampWeightKg(kilograms) / KG_PER_LB);
}

export function formatWeight(kilograms: number, unit: WeightUnit): string {
  return unit === 'kg' ? `${Math.round(clampWeightKg(kilograms))} kg` : `${kgToLb(kilograms)} lb`;
}

/** Wheel values are stored in kg; each lb tick maps to its kg equivalent. */
export function weightWheelValues(unit: WeightUnit): number[] {
  const values: number[] = [];
  if (unit === 'kg') {
    for (let kg = WEIGHT_KG_MIN; kg <= WEIGHT_KG_MAX; kg += 1) {
      values.push(kg);
    }
    return values;
  }

  for (let lb = kgToLb(WEIGHT_KG_MIN); lb <= kgToLb(WEIGHT_KG_MAX); lb += 1) {
    values.push(lbToKg(lb));
  }
  return values;
}
