import type {
  ConfidenceGateInput,
  ConfidenceGateResult,
  GarmentIngestTier,
} from '@/types/garment';

/** HNSW cosine similarity required for a high-confidence drape (AGENTS.md §7). */
export const HNSW_SIMILARITY_THRESHOLD = 0.995;

/** Stated vs skeleton height after the Cog hard constraint. */
export const HEIGHT_RESIDUAL_TOLERANCE_CM = 4;

/** 1 − silhouette occupancy. Large values mean clothes inflated the outline. */
export const CLOTHING_RESIDUAL_TOLERANCE = 0.3;

export function residualWithinTolerance(
  heightResidualCm: number | null | undefined,
  clothingResidual: number | null | undefined,
): boolean {
  if (heightResidualCm != null && heightResidualCm > HEIGHT_RESIDUAL_TOLERANCE_CM) {
    return false;
  }

  if (clothingResidual != null && clothingResidual > CLOTHING_RESIDUAL_TOLERANCE) {
    return false;
  }

  return true;
}

/**
 * Tier 1 CAD is trusted. Tier 2 counts when ingest already cleared
 * approximate-fit (validated Mode B: product-page size chart + material).
 */
export function ingestAllowsHighConfidence(
  ingestTier: GarmentIngestTier | null,
  approximateFit: boolean,
): boolean {
  if (ingestTier === 1) {
    return true;
  }

  return ingestTier === 2 && !approximateFit;
}

export function evaluateConfidenceGate(input: ConfidenceGateInput): ConfidenceGateResult {
  const capturePassed = input.captureGatesPassed;
  const ingestPassed = ingestAllowsHighConfidence(input.ingestTier, input.approximateFit);
  const hnswPassed =
    input.hnswSimilarity !== null && input.hnswSimilarity >= HNSW_SIMILARITY_THRESHOLD;
  const drapePassed = hnswPassed || input.xpbdCompleted;
  const residualPassed = residualWithinTolerance(
    input.heightResidualCm,
    input.clothingResidual,
  );
  const printPassed = input.printQaPassed !== false;

  return {
    highConfidence: capturePassed && ingestPassed && drapePassed && residualPassed && printPassed,
    capturePassed,
    ingestPassed,
    drapePassed,
    residualPassed,
    printPassed,
    hnswSimilarity: input.hnswSimilarity,
    xpbdCompleted: input.xpbdCompleted,
  };
}
