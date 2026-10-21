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

/**
 * How much room one size leaves on this body, from the published chart: the
 * size's girth minus the shopper's, per region the size is chosen by. Unlike
 * the drape's clearance (cloth touches the chest in every size), it differs
 * from size to size, so the shopper can compare S, M and L. Worded against the
 * same wearing-ease target the size number uses; it never changes the size.
 */
export interface SizeRoom {
  region: FitRegion;
  roomCm: number;
  word: FitWord;
}

const ROOM_REGIONS: Record<string, Array<[FitRegion, 'chestCm' | 'waistCm' | 'hipCm', 'chest_cm' | 'waist_cm' | 'hip_cm']>> = {
  tee: [['chest', 'chestCm', 'chest_cm'], ['waist', 'waistCm', 'waist_cm']],
  outerwear: [['chest', 'chestCm', 'chest_cm'], ['waist', 'waistCm', 'waist_cm']],
  pant: [['waist', 'waistCm', 'waist_cm'], ['hips', 'hipCm', 'hip_cm']],
  dress: [['chest', 'chestCm', 'chest_cm'], ['waist', 'waistCm', 'waist_cm'], ['hips', 'hipCm', 'hip_cm']],
};

/** Room as a share of the ease target: below these it reads tight, snug, regular, relaxed; above, loose. */
const ROOM_BANDS = { tight: 0.25, snug: 0.7, comfortable: 1.4, relaxed: 2 } as const;

export function roomWord(roomCm: number, targetCm: number): FitWord {
  const share = roomCm / Math.max(targetCm, 1);
  if (share < ROOM_BANDS.tight) return 'tight';
  if (share < ROOM_BANDS.snug) return 'snug';
  if (share <= ROOM_BANDS.comfortable) return 'comfortable';
  if (share <= ROOM_BANDS.relaxed) return 'relaxed';
  return 'loose';
}

export function sizeRoom(
  category: GarmentCategory | null | undefined,
  size: { chestCm: number; waistCm: number; hipCm: number },
  body: { chest_cm: number; waist_cm: number; hip_cm: number },
  easeTarget: { chestCm: number; waistCm: number; hipCm: number },
): SizeRoom[] {
  return (ROOM_REGIONS[category ?? ''] ?? [])
    .filter(([, sizeKey, bodyKey]) => size[sizeKey] > 0 && body[bodyKey] > 0)
    .map(([region, sizeKey, bodyKey]) => {
      const roomCm = size[sizeKey] - body[bodyKey];
      return { region, roomCm, word: roomWord(roomCm, easeTarget[sizeKey]) };
    });
}

/** "13 cm of room at the chest (relaxed)", or "4 cm smaller than you at the waist". */
export function sizeRoomLine(rooms: readonly SizeRoom[]): string | null {
  if (rooms.length === 0) {
    return null;
  }
  return rooms
    .map((room) => {
      const cm = Math.round(Math.abs(room.roomCm));
      return room.roomCm < 0
        ? `${cm} cm smaller than you at the ${room.region}`
        : `${cm} cm of room at the ${room.region} (${room.word})`;
    })
    .join(' · ');
}
