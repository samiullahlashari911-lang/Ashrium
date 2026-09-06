/**
 * Garment domain models shared by dashboard input, catalog ingest, and cloth sim.
 */

export interface GarmentMechanicalProperties {
  /** Tensile stiffness S_t (N/m). */
  tensileStiffness: number;
  /** Bending rigidity B_r (N*m). */
  bendingRigidity: number;
  /** Shear stiffness S_s (N/m). */
  shearStiffness: number;
  /** Area density rho_a (kg/m^2). */
  areaDensity: number;
}

export type GarmentCategory = 'tee' | 'pant' | 'dress' | 'outerwear' | 'other';
export type GarmentIngestMode = 'A' | 'B' | 'C';
export type GarmentIngestTier = 1 | 2;

export interface GarmentFiberComposition {
  [fiber: string]: number;
}

export interface GarmentSizeVariant {
  sizeCode: string;
  chestCm: number;
  waistCm: number;
  hipCm: number;
  lengthCm: number;
  restLengthStoragePath: string | null;
}

export interface Garment {
  id: string;
  tenantId: string;
  sku: string;
  name: string;
  category: GarmentCategory | null;
  composition: GarmentFiberComposition | null;
  gsm: number | null;
  ingestConfidence: number | null;
  ingestTier: GarmentIngestTier | null;
  mode: GarmentIngestMode | null;
  approximateFit: boolean;
  mechanical: GarmentMechanicalProperties;
  cadPatternUrl: string | null;
  sizeVariants: GarmentSizeVariant[];
}

/** Widget-safe garment payload: no CAD rest-lengths, no catalog credentials. */
export interface StorefrontGarment {
  sku: string;
  name: string;
  category: GarmentCategory | null;
  ingestConfidence: number | null;
  ingestTier: GarmentIngestTier | null;
  approximateFit: boolean;
  sizeVariants: StorefrontSizeVariant[];
}

export interface StorefrontSizeVariant {
  id: string | null;
  sizeCode: string;
  chestCm: number;
  waistCm: number;
  hipCm: number;
  lengthCm: number;
}

export interface CategoryEaseCm {
  chestCm: number;
  waistCm: number;
  hipCm: number;
}

export type SizeRecommendSource = 'variant' | 'ease_chart';

export interface SizeRecommendation {
  sizeCode: string;
  source: SizeRecommendSource;
  variantId: string | null;
  chestCm: number;
  waistCm: number;
  hipCm: number;
  lengthCm: number;
}

export interface ConfidenceGateInput {
  captureGatesPassed: boolean;
  ingestTier: GarmentIngestTier | null;
  approximateFit: boolean;
  hnswSimilarity: number | null;
  xpbdCompleted: boolean;
}

export interface ConfidenceGateResult {
  highConfidence: boolean;
  capturePassed: boolean;
  ingestPassed: boolean;
  drapePassed: boolean;
  hnswSimilarity: number | null;
  xpbdCompleted: boolean;
}

export interface FitRecommendation {
  size: SizeRecommendation;
  gate: ConfidenceGateResult;
  category: GarmentCategory | null;
  ease: CategoryEaseCm;
}

export const GARMENT_CATEGORIES: readonly GarmentCategory[] = [
  'tee',
  'pant',
  'dress',
  'outerwear',
  'other',
];

export function readGarmentCategory(value: unknown): GarmentCategory | null {
  if (typeof value !== 'string') {
    return null;
  }

  return GARMENT_CATEGORIES.includes(value as GarmentCategory)
    ? (value as GarmentCategory)
    : null;
}

export const GARMENT_INGEST_MODES: readonly GarmentIngestMode[] = ['A', 'B', 'C'];

export function readGarmentIngestTier(value: unknown): GarmentIngestTier | null {
  return value === 1 || value === 2 ? value : null;
}

export function readGarmentIngestMode(value: unknown): GarmentIngestMode | null {
  return value === 'A' || value === 'B' || value === 'C' ? value : null;
}

export function readGarmentComposition(value: unknown): GarmentFiberComposition | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const composition: GarmentFiberComposition = {};
  for (const [fiber, amount] of Object.entries(value)) {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      continue;
    }

    const name = fiber.trim().toLowerCase();
    if (name.length === 0 || name.length > 32) {
      continue;
    }

    composition[name] = amount;
  }

  return Object.keys(composition).length > 0 ? composition : null;
}

export function formatComposition(composition: GarmentFiberComposition | null): string {
  if (!composition) {
    return '';
  }

  return Object.entries(composition)
    .sort((left, right) => right[1] - left[1])
    .map(([fiber, amount]) => `${Math.round(amount)}% ${fiber}`)
    .join(', ');
}

export interface CatalogSizeVariantInput {
  sizeCode: string;
  chestCm: number;
  waistCm: number;
  hipCm: number;
  lengthCm: number;
  externalSku: string | null;
  measurementsFromSource: boolean;
}

export interface CatalogGarmentDraft {
  sku: string;
  name: string;
  category: GarmentCategory;
  composition: GarmentFiberComposition | null;
  gsm: number | null;
  ingestConfidence: number;
  ingestTier: GarmentIngestTier;
  mode: GarmentIngestMode;
  approximateFit: boolean;
  mechanical: GarmentMechanicalProperties;
  cadPatternUrl: string | null;
  sizeVariants: CatalogSizeVariantInput[];
}

export const REST_LENGTH_SCHEMA = 'ashrium.rest_length.v1' as const;

export interface RestLengthMesh {
  schema: typeof REST_LENGTH_SCHEMA;
  category: GarmentCategory;
  sizeCode: string;
  measurements: {
    chestCm: number;
    waistCm: number;
    hipCm: number;
    lengthCm: number;
  };
  rows: number;
  cols: number;
  vertices: number[];
  edges: Array<[number, number]>;
  restLengths: number[];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readRestLengthMesh(value: unknown): RestLengthMesh | null {
  if (!isRecord(value) || value.schema !== REST_LENGTH_SCHEMA) {
    return null;
  }

  const category = readGarmentCategory(value.category);
  const measurements = value.measurements;
  if (
    !category
    || typeof value.sizeCode !== 'string'
    || value.sizeCode.length === 0
    || !isRecord(measurements)
    || !isFiniteNumber(measurements.chestCm)
    || !isFiniteNumber(measurements.waistCm)
    || !isFiniteNumber(measurements.hipCm)
    || !isFiniteNumber(measurements.lengthCm)
    || !isFiniteNumber(value.rows)
    || !isFiniteNumber(value.cols)
    || !Array.isArray(value.vertices)
    || !Array.isArray(value.edges)
    || !Array.isArray(value.restLengths)
  ) {
    return null;
  }

  const rows = Math.trunc(value.rows);
  const cols = Math.trunc(value.cols);
  if (rows < 2 || cols < 2 || value.vertices.length !== rows * cols * 2) {
    return null;
  }

  if (!value.vertices.every(isFiniteNumber)) {
    return null;
  }

  const edges: Array<[number, number]> = [];
  for (const edge of value.edges) {
    if (
      !Array.isArray(edge)
      || edge.length !== 2
      || !isFiniteNumber(edge[0])
      || !isFiniteNumber(edge[1])
    ) {
      return null;
    }

    edges.push([Math.trunc(edge[0]), Math.trunc(edge[1])]);
  }

  if (value.restLengths.length !== edges.length || !value.restLengths.every(isFiniteNumber)) {
    return null;
  }

  return {
    schema: REST_LENGTH_SCHEMA,
    category,
    sizeCode: value.sizeCode,
    measurements: {
      chestCm: measurements.chestCm,
      waistCm: measurements.waistCm,
      hipCm: measurements.hipCm,
      lengthCm: measurements.lengthCm,
    },
    rows,
    cols,
    vertices: value.vertices.slice(),
    edges,
    restLengths: value.restLengths.slice(),
  };
}
