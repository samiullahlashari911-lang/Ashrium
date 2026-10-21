import type { GarmentCategory, SewnGarmentMesh } from '@/types/garment';

/**
 * Same rule and constant as `gpu/drape/sewn.py::too_small`, checked before any
 * GPU call: a size needs MIN_EASE over the body at its closing girth (chest
 * for tops, seat for bottoms, plus the waist when it has no elastic).
 */
export const MIN_EASE = 0.02;

interface BodyGirths {
  chest_cm: number;
  waist_cm: number;
  hip_cm: number;
}

function readCm(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function sizeTooSmall(
  category: GarmentCategory,
  patternGirths: Record<string, unknown>,
  body: BodyGirths,
  elasticWaist: boolean,
): string | null {
  const keys: Array<[string, keyof BodyGirths]> = category === 'pant'
    ? [['hipCm', 'hip_cm']]
    : [['chestCm', 'chest_cm']];
  if (category === 'pant' && !elasticWaist) {
    keys.push(['waistCm', 'waist_cm']);
  }

  for (const [patternKey, bodyKey] of keys) {
    const garment = readCm(patternGirths[patternKey]);
    const girth = readCm(body[bodyKey]);
    if (garment > 0 && girth > 0 && garment < girth * (1 + MIN_EASE)) {
      return `${patternKey.replace(/Cm$/, '')} ${garment.toFixed(0)} cm on a ${girth.toFixed(0)} cm body`;
    }
  }

  return null;
}

export function sewnSizeTooSmall(sewn: SewnGarmentMesh, body: BodyGirths): string | null {
  const patternGirths = sewn.json.pattern_girths;
  return sizeTooSmall(
    sewn.category,
    typeof patternGirths === 'object' && patternGirths !== null ? patternGirths as Record<string, unknown> : {},
    body,
    sewn.json.elastic_waist === true,
  );
}
