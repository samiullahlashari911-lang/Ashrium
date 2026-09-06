import type { GarmentCategory, GarmentFiberComposition, GarmentMechanicalProperties } from '@/types/garment';

interface FiberKesBase {
  tensileStiffness: number;
  bendingRigidity: number;
  shearStiffness: number;
}

/** Kawabata-style bases at 180 GSM, mapped onto garment_cad_profiles mechanical columns. */
const FIBER_KES_AT_180_GSM: Record<string, FiberKesBase> = {
  cotton: { tensileStiffness: 90, bendingRigidity: 0.04, shearStiffness: 45 },
  polyester: { tensileStiffness: 70, bendingRigidity: 0.03, shearStiffness: 35 },
  nylon: { tensileStiffness: 55, bendingRigidity: 0.025, shearStiffness: 30 },
  wool: { tensileStiffness: 80, bendingRigidity: 0.06, shearStiffness: 50 },
  linen: { tensileStiffness: 140, bendingRigidity: 0.09, shearStiffness: 70 },
  silk: { tensileStiffness: 50, bendingRigidity: 0.015, shearStiffness: 20 },
  viscose: { tensileStiffness: 60, bendingRigidity: 0.025, shearStiffness: 28 },
  rayon: { tensileStiffness: 60, bendingRigidity: 0.025, shearStiffness: 28 },
  modal: { tensileStiffness: 58, bendingRigidity: 0.022, shearStiffness: 26 },
  lyocell: { tensileStiffness: 62, bendingRigidity: 0.024, shearStiffness: 27 },
  tencel: { tensileStiffness: 62, bendingRigidity: 0.024, shearStiffness: 27 },
  acrylic: { tensileStiffness: 65, bendingRigidity: 0.035, shearStiffness: 32 },
  hemp: { tensileStiffness: 150, bendingRigidity: 0.1, shearStiffness: 75 },
  cashmere: { tensileStiffness: 48, bendingRigidity: 0.02, shearStiffness: 22 },
  elastane: { tensileStiffness: 8, bendingRigidity: 0.008, shearStiffness: 10 },
  spandex: { tensileStiffness: 8, bendingRigidity: 0.008, shearStiffness: 10 },
  lycra: { tensileStiffness: 8, bendingRigidity: 0.008, shearStiffness: 10 },
  other: { tensileStiffness: 80, bendingRigidity: 0.04, shearStiffness: 40 },
};

const FIBER_ALIASES: Record<string, string> = {
  poly: 'polyester',
  polyamide: 'nylon',
  pa: 'nylon',
  pes: 'polyester',
  cot: 'cotton',
  linenflax: 'linen',
  flax: 'linen',
  viscose: 'viscose',
  rayon: 'rayon',
  spandex: 'elastane',
  lycra: 'elastane',
  pbt: 'elastane',
  'elasterell-p': 'elastane',
};

const CATEGORY_DEFAULT_GSM: Record<GarmentCategory, number> = {
  tee: 180,
  pant: 240,
  dress: 160,
  outerwear: 320,
  other: 200,
};

const CATEGORY_DEFAULT_FIBER: Record<GarmentCategory, string> = {
  tee: 'cotton',
  pant: 'cotton',
  dress: 'viscose',
  outerwear: 'polyester',
  other: 'cotton',
};

const REFERENCE_GSM = 180;

export function normalizeFiberName(raw: string): string {
  const compact = raw.trim().toLowerCase().replace(/[^a-z]+/g, '');
  if (compact.length === 0) {
    return 'other';
  }

  if (FIBER_KES_AT_180_GSM[compact]) {
    return compact;
  }

  return FIBER_ALIASES[compact] ?? 'other';
}

export function categoryDefaultGsm(category: GarmentCategory): number {
  return CATEGORY_DEFAULT_GSM[category];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fiberBase(fiber: string): FiberKesBase {
  return FIBER_KES_AT_180_GSM[fiber] ?? FIBER_KES_AT_180_GSM.other;
}

/**
 * Maps fiber composition + GSM onto tensile / bending / shear / area density.
 * Elastane content reduces tensile and shear stiffness (more stretch).
 */
export function lookupKesProperties(
  composition: GarmentFiberComposition | null,
  gsm: number | null,
  category: GarmentCategory,
): GarmentMechanicalProperties {
  const resolvedGsm = gsm && gsm > 0 ? gsm : CATEGORY_DEFAULT_GSM[category];
  const entries = composition
    ? Object.entries(composition).map(([fiber, amount]) => ({
        fiber: normalizeFiberName(fiber),
        amount,
      }))
    : [{ fiber: CATEGORY_DEFAULT_FIBER[category], amount: 100 }];

  const total = entries.reduce((sum, entry) => sum + entry.amount, 0);
  const weight = total > 0 ? total : 1;

  let tensile = 0;
  let bending = 0;
  let shear = 0;
  let elastaneFraction = 0;

  for (const entry of entries) {
    const share = entry.amount / weight;
    const base = fiberBase(entry.fiber);
    tensile += base.tensileStiffness * share;
    bending += base.bendingRigidity * share;
    shear += base.shearStiffness * share;
    if (entry.fiber === 'elastane') {
      elastaneFraction += share;
    }
  }

  const gsmScale = clamp(Math.pow(resolvedGsm / REFERENCE_GSM, 1.15), 0.5, 2.5);
  if (elastaneFraction >= 0.02) {
    tensile /= 1 + 8 * elastaneFraction;
    shear /= 1 + 4 * elastaneFraction;
  }

  return {
    tensileStiffness: clamp(tensile * gsmScale, 4, 400),
    bendingRigidity: clamp(bending * gsmScale, 0.004, 0.4),
    shearStiffness: clamp(shear * gsmScale, 6, 200),
    areaDensity: clamp(resolvedGsm / 1000, 0.05, 0.8),
  };
}

export function mechanicalDeltaRatio(
  left: GarmentMechanicalProperties,
  right: GarmentMechanicalProperties,
): number {
  const keys: (keyof GarmentMechanicalProperties)[] = [
    'tensileStiffness',
    'bendingRigidity',
    'shearStiffness',
    'areaDensity',
  ];

  return Math.max(
    ...keys.map((key) => {
      const baseline = Math.abs(right[key]) < 1e-9 ? 1 : Math.abs(right[key]);
      return Math.abs(left[key] - right[key]) / baseline;
    }),
  );
}
