import type { AnnyPhenotype, BodyGirthMeasurements } from '@/types/hmr';

/**
 * 6-D cache key for `simulation_cache.phenotype vector(6)`.
 * Girths + height dominate; residuals keep similar bodies from collapsing.
 */
export function mhrSimulationCacheVector(input: {
  measurements: BodyGirthMeasurements;
  heightCm: number;
  heightResidualCm?: number | null;
  clothingResidual?: number | null;
}): AnnyPhenotype {
  return [
    input.measurements.chest_cm / 200,
    input.measurements.waist_cm / 200,
    input.measurements.hip_cm / 200,
    input.heightCm / 200,
    (input.heightResidualCm ?? 0) / 10,
    input.clothingResidual ?? 0,
  ];
}
