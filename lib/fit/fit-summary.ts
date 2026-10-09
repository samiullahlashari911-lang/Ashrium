import { FIT_CLEARANCE_RATIOS } from '@/lib/graphics/radial-heatmap';
import type { GarmentCategory } from '@/types/garment';

/**
 * One plain line about how the draped garment sits ("Snug at chest ·
 * comfortable at waist"), read from the drape's per-vertex clearance with the
 * same ease bands as the heatmap. It describes the look; it never changes the
 * size, which comes from girths + the chart.
 */
export type FitRegion = 'chest' | 'waist' | 'hips';
export type FitWord = 'tight' | 'snug' | 'comfortable' | 'relaxed' | 'loose';

/** Region heights as fractions of stature (same landmarks as the girth fallback). */
const REGION_HEIGHT: Record<FitRegion, number> = { chest: 0.72, waist: 0.61, hips: 0.53 };
const BAND_HALF_STATURE = 0.025;
const MIN_REGION_VERTICES = 12;

export function fitRegionsFor(category: GarmentCategory | null | undefined): FitRegion[] {
  switch (category) {
    case 'pant':
      return ['waist', 'hips'];
    case 'dress':
      return ['chest', 'waist', 'hips'];
    case 'tee':
    case 'outerwear':
      return ['chest', 'waist'];
    default:
      return [];
  }
}

export function fitWord(clearanceCm: number, easeCm: number): FitWord {
  const ratio = clearanceCm / Math.max(easeCm, 1);
  const { contact, idealStart, idealEnd, looseEnd } = FIT_CLEARANCE_RATIOS;
  if (ratio < contact) return 'tight';
  if (ratio < idealStart) return 'snug';
  if (ratio <= idealEnd) return 'comfortable';
  if (ratio < looseEnd) return 'relaxed';
  return 'loose';
}

export interface FitRegionSummary {
  region: FitRegion;
  word: FitWord;
  clearanceCm: number;
}

/**
 * `positionsY` are the draped garment's vertex heights in the body's frame
 * (metres, floor at `floorY`); `clearanceCm` is per garment vertex.
 */
export function summarizeFit(input: {
  positionsY: ArrayLike<number>;
  clearanceCm: ArrayLike<number>;
  floorY: number;
  statureM: number;
  category: GarmentCategory | null | undefined;
  easeCm: number;
}): FitRegionSummary[] {
  const summaries: FitRegionSummary[] = [];
  const band = BAND_HALF_STATURE * input.statureM;
  for (const region of fitRegionsFor(input.category)) {
    const level = input.floorY + REGION_HEIGHT[region] * input.statureM;
    const values: number[] = [];
    for (let i = 0; i < input.positionsY.length; i += 1) {
      const clearance = input.clearanceCm[i]!;
      if (Math.abs(input.positionsY[i]! - level) <= band && Number.isFinite(clearance)) {
        values.push(clearance);
      }
    }
    if (values.length < MIN_REGION_VERTICES) {
      continue;
    }
    values.sort((a, b) => a - b);
    const median = values[Math.floor(values.length / 2)]!;
    summaries.push({ region, word: fitWord(median, input.easeCm), clearanceCm: median });
  }
  return summaries;
}

export function fitSummaryLine(summaries: readonly FitRegionSummary[]): string | null {
  if (summaries.length === 0) {
    return null;
  }
  const line = summaries.map((summary) => `${summary.word} at ${summary.region}`).join(' · ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}
