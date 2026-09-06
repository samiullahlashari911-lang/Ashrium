import { strainHeatmap, strainHeatmapRgb, type Rgb01 } from '@/lib/design-tokens';
import type { StrainColor } from '@/types/graphics';

/**
 * Fit colouring is driven by clearance, never by strain.
 *
 * Clearance is a position quantity, so it degrades linearly with mesh error.
 * Strain is a spatial derivative of position, so the same mesh error is
 * amplified by roughly one over the error-field correlation length — landing in
 * the same order of magnitude as the tight/loose decision band itself. Strain
 * also cannot distinguish slack cloth from a perfect fit: an oversized garment
 * hangs at strain ≈ 0, exactly like a garment that fits. Clearance separates
 * those two cases, which is what "loose reads blue" requires.
 *
 * Breakpoints are expressed as ratios of the garment's wearing ease so the
 * WebGL path in `strain-shader.ts` can consume the identical model as uniforms.
 */
export const FIT_CLEARANCE_RATIOS = {
  /** Below this the garment is in contact/compression: constricted. */
  contact: 0,
  /** constricted → snug ramp ends here. */
  snugEnd: 0.5,
  /** snug → ideal ramp ends here; ideal plateau begins. */
  idealStart: 1,
  /** Ideal plateau ends here; loose ramp begins. */
  idealEnd: 1.5,
  /** Fully loose at or beyond this ratio. */
  looseEnd: 2.5,
} as const;

/** Fallback wearing ease when a garment profile carries none, in centimetres. */
export const DEFAULT_EASE_CM = 8;

/**
 * Approximate radial-distance heatmap (Phase 2).
 * clearanceCm = garment radius − body radius, in centimetres.
 * Blue / green / amber / red per AGENTS.md §7.
 */
export function mapRadialClearanceToColor(clearanceCm: number, easeCm: number): StrainColor {
  const ease = Math.max(easeCm, 1);
  const ratio = clearanceCm / ease;
  const { contact, snugEnd, idealStart, idealEnd, looseEnd } = FIT_CLEARANCE_RATIOS;

  if (ratio < contact) {
    return strainHeatmapRgb.constricted;
  }

  if (ratio < snugEnd) {
    return lerpColor(strainHeatmapRgb.constricted, strainHeatmapRgb.snug, ratio / snugEnd);
  }

  if (ratio < idealStart) {
    return lerpColor(
      strainHeatmapRgb.snug,
      strainHeatmapRgb.ideal,
      (ratio - snugEnd) / (idealStart - snugEnd),
    );
  }

  if (ratio <= idealEnd) {
    return strainHeatmapRgb.ideal;
  }

  return lerpColor(
    strainHeatmapRgb.ideal,
    strainHeatmapRgb.loose,
    Math.min((ratio - idealEnd) / (looseEnd - idealEnd), 1),
  );
}

export function computeRadialHeatmapColors(
  clearancesCm: Float32Array,
  easeCm: number,
): Float32Array {
  const colors = new Float32Array(clearancesCm.length * 3);

  for (let index = 0; index < clearancesCm.length; index += 1) {
    const color = mapRadialClearanceToColor(clearancesCm[index], easeCm);
    const base = index * 3;
    colors[base] = color.r;
    colors[base + 1] = color.g;
    colors[base + 2] = color.b;
  }

  return colors;
}

export const RADIAL_HEATMAP_SWATCHES = [
  { label: 'Constricted', color: strainHeatmap.constricted },
  { label: 'Snug', color: strainHeatmap.snug },
  { label: 'Ideal ease', color: strainHeatmap.ideal },
  { label: 'Loose', color: strainHeatmap.loose },
] as const;

function lerpColor(from: Rgb01, to: Rgb01, t: number): StrainColor {
  const clamped = Math.min(1, Math.max(0, t));
  return {
    r: from.r + (to.r - from.r) * clamped,
    g: from.g + (to.g - from.g) * clamped,
    b: from.b + (to.b - from.b) * clamped,
  };
}
