import { strainHeatmap, strainHeatmapRgb } from '@/lib/design-tokens';
import type { StrainColor } from '@/types/graphics';

/** Cauchy strain threshold above which fit is constricted (>15% stretch). */
export const STRAIN_CONSTRICTED_THRESHOLD = strainHeatmap.constrictedThreshold;

/** Ideal contour fit lower bound (zero pressure boundary). */
export const STRAIN_IDEAL_LOWER_BOUND = 0.0;

const CONSTRUCTED_COLOR: StrainColor = strainHeatmapRgb.constricted;
const IDEAL_COLOR: StrainColor = strainHeatmapRgb.ideal;
const LOOSE_COLOR: StrainColor = strainHeatmapRgb.loose;

/**
 * Maps a single Cauchy strain value to an RGB heatmap color.
 * - Red:   strain > 0.15 (constricted)
 * - Green: 0.0 <= strain <= 0.15 (ideal contour fit)
 * - Blue:  strain < 0.0 (loose folds / zero pressure)
 */
export function mapStrainToColor(strain: number): StrainColor {
  if (strain > STRAIN_CONSTRICTED_THRESHOLD) {
    return CONSTRUCTED_COLOR;
  }

  if (strain >= STRAIN_IDEAL_LOWER_BOUND) {
    return IDEAL_COLOR;
  }

  return LOOSE_COLOR;
}

/**
 * Computes per-vertex strain from the average stretch of its connected triangle edges.
 * This is translation-invariant: moving the garment in world space does not create strain.
 */
export function computeVertexStrains(
  restPositions: Float32Array,
  deformedPositions: Float32Array,
  faceIndices: Uint32Array,
): Float32Array {
  const vertexCount = restPositions.length / 3;
  const strains = new Float32Array(vertexCount);
  const sampleCounts = new Uint32Array(vertexCount);
  const epsilonGuard = 1e-6;

  const edgeStrain = (vertexA: number, vertexB: number): number => {
    const baseA = vertexA * 3;
    const baseB = vertexB * 3;

    const restLength = Math.hypot(
      restPositions[baseA] - restPositions[baseB],
      restPositions[baseA + 1] - restPositions[baseB + 1],
      restPositions[baseA + 2] - restPositions[baseB + 2],
    );
    const deformedLength = Math.hypot(
      deformedPositions[baseA] - deformedPositions[baseB],
      deformedPositions[baseA + 1] - deformedPositions[baseB + 1],
      deformedPositions[baseA + 2] - deformedPositions[baseB + 2],
    );

    return (deformedLength - restLength) / Math.max(restLength, epsilonGuard);
  };

  const addEdgeSample = (vertexA: number, vertexB: number): void => {
    const strain = edgeStrain(vertexA, vertexB);
    strains[vertexA] += strain;
    strains[vertexB] += strain;
    sampleCounts[vertexA] += 1;
    sampleCounts[vertexB] += 1;
  };

  for (let faceOffset = 0; faceOffset < faceIndices.length; faceOffset += 3) {
    const vertexA = faceIndices[faceOffset];
    const vertexB = faceIndices[faceOffset + 1];
    const vertexC = faceIndices[faceOffset + 2];

    addEdgeSample(vertexA, vertexB);
    addEdgeSample(vertexB, vertexC);
    addEdgeSample(vertexC, vertexA);
  }

  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    if (sampleCounts[vertexIndex] > 0) {
      strains[vertexIndex] /= sampleCounts[vertexIndex];
    }
  }

  return strains;
}

/**
 * Converts Cauchy strain samples into flattened RGB vertex colors for Three.js.
 */
export function computeVertexStrainColors(strains: Float32Array): Float32Array {
  const colors = new Float32Array(strains.length * 3);

  for (let vertexIndex = 0; vertexIndex < strains.length; vertexIndex += 1) {
    const color = mapStrainToColor(strains[vertexIndex]);
    const colorBase = vertexIndex * 3;

    colors[colorBase] = color.r;
    colors[colorBase + 1] = color.g;
    colors[colorBase + 2] = color.b;
  }

  return colors;
}

/**
 * Generates synthetic preview strains when measured simulation data is unavailable.
 */
export function createSyntheticStrainField(vertexCount: number, yPositions: Float32Array): Float32Array {
  const strains = new Float32Array(vertexCount);

  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    const yPos = yPositions[vertexIndex];
    strains[vertexIndex] = Math.sin(yPos * 4.0) * 0.2;
  }

  return strains;
}
