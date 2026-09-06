import type {
  ConfidenceGateInput,
  ConfidenceGateResult,
  GarmentIngestTier,
} from '@/types/garment';

/** HNSW cosine similarity required for a high-confidence drape (AGENTS.md §7). */
export const HNSW_SIMILARITY_THRESHOLD = 0.995;

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

  return {
    highConfidence: capturePassed && ingestPassed && drapePassed,
    capturePassed,
    ingestPassed,
    drapePassed,
    hnswSimilarity: input.hnswSimilarity,
    xpbdCompleted: input.xpbdCompleted,
  };
}
