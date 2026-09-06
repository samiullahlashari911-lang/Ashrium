import { evaluateConfidenceGate } from '@/lib/fit/confidence-gate';
import { categoryEase, recommendSize } from '@/lib/fit/size-recommend';
import type { AnnyDerivedMeasurements } from '@/types/hmr';
import type {
  FitRecommendation,
  GarmentCategory,
  GarmentIngestTier,
  StorefrontSizeVariant,
} from '@/types/garment';

export interface RecommendFitInput {
  measurements: AnnyDerivedMeasurements;
  category: GarmentCategory | null;
  variants: readonly StorefrontSizeVariant[];
  captureGatesPassed: boolean;
  ingestTier: GarmentIngestTier | null;
  approximateFit: boolean;
  hnswSimilarity?: number | null;
  xpbdCompleted?: boolean;
  heightResidualCm?: number | null;
  clothingResidual?: number | null;
  printQaPassed?: boolean;
}

export function recommendFit(input: RecommendFitInput): FitRecommendation {
  const size = recommendSize(input.measurements, input.category, input.variants);
  const gate = evaluateConfidenceGate({
    captureGatesPassed: input.captureGatesPassed,
    ingestTier: input.ingestTier,
    approximateFit: input.approximateFit,
    hnswSimilarity: input.hnswSimilarity ?? null,
    xpbdCompleted: input.xpbdCompleted ?? false,
    heightResidualCm: input.heightResidualCm,
    clothingResidual: input.clothingResidual,
    printQaPassed: input.printQaPassed,
  });

  return {
    size,
    gate,
    category: input.category,
    ease: categoryEase(input.category),
  };
}
