export type HeightUnit = 'cm' | 'ft_in';

export const HEIGHT_CM_MIN = 50;
export const HEIGHT_CM_MAX = 250;
export const HEIGHT_CM_DEFAULT = 170;

export function clampHeightCm(value: number): number {
  if (!Number.isFinite(value)) {
    return HEIGHT_CM_DEFAULT;
  }

  return Math.min(HEIGHT_CM_MAX, Math.max(HEIGHT_CM_MIN, Math.round(value)));
}

export function cmToFeetInches(heightCm: number): { feet: number; inches: number } {
  const totalInches = Math.round(clampHeightCm(heightCm) / 2.54);
  const feet = Math.floor(totalInches / 12);
  return { feet, inches: totalInches - feet * 12 };
}

export function feetInchesToCm(feet: number, inches: number): number {
  return clampHeightCm((feet * 12 + inches) * 2.54);
}

export function formatHeight(heightCm: number, unit: HeightUnit): string {
  if (unit === 'cm') {
    return `${clampHeightCm(heightCm)} cm`;
  }

  const { feet, inches } = cmToFeetInches(heightCm);
  return `${feet}′ ${inches}″`;
}

export function heightDialValues(unit: HeightUnit): number[] {
  if (unit === 'cm') {
    const values: number[] = [];
    for (let cm = HEIGHT_CM_MIN; cm <= HEIGHT_CM_MAX; cm += 1) {
      values.push(cm);
    }
    return values;
  }

  const values: number[] = [];
  const seen = new Set<number>();
  for (
    let totalInches = Math.round(HEIGHT_CM_MIN / 2.54);
    totalInches <= Math.round(HEIGHT_CM_MAX / 2.54);
    totalInches += 1
  ) {
    const cm = clampHeightCm(totalInches * 2.54);
    if (!seen.has(cm)) {
      seen.add(cm);
      values.push(cm);
    }
  }
  return values;
}
