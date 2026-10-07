/**
 * Ashrium design system — single source of truth for the marketing site,
 * merchant dashboard, storefront widget, WebGL scene colours, and the 8px
 * spatial rhythm.
 *
 * Palette (from the owner's reference board): warm off-white canvas, white
 * cards on hairline borders, near-black ink, one violet accent for calls to
 * action. Fit heatmap swatches stay independent of the UI accent so cloth
 * visualization never reads as "brand colour".
 *
 * Tailwind exposes these as `ash-*` colours through CSS variables declared in
 * `app/globals.css`; keep the three in sync.
 */

export const SPATIAL_GRID_PX = 8 as const;

export const ashrium = {
  canvas: '#F4F1EC',
  raised: '#FAF8F5',
  surface: '#FFFFFF',
  line: '#E6E1D9',
  ink: '#1D1B22',
  muted: '#6B6775',
  subtle: '#9A96A1',
  accent: '#6A4CF5',
  accentStrong: '#5536E0',
  accentSoft: '#EEEAFE',
  success: '#1F9D63',
  successSoft: '#E3F4EA',
  tension: '#DC3D4A',
  tensionSoft: '#FCE7E9',
  /** Faceless mannequin albedo: neutral stone, deliberately not a skin tone (AGENTS.md §8). */
  mannequin: '#CFCDC9',
} as const;

export type AshriumColor = (typeof ashrium)[keyof typeof ashrium];

/** Card recipe used by `.ash-card` in globals.css. */
export const cardTokens = {
  radiusPx: 24,
  borderWidthPx: 1,
  /** Dashboard cards never use backdrop-filter (sticky nav scroll cost). */
  dashboardBlurPx: 0,
} as const;

/**
 * CSS class names owned by this token module (`app/globals.css`).
 * Prefer these over raw white/slate utilities.
 */
export const themeClasses = {
  card: 'ash-card',
  cta: 'ash-cta',
  ctaSecondary: 'ash-cta-secondary',
  input: 'ash-input',
  inputBox: 'ash-input-box',
} as const;

/** Kept as sky blue so loose regions read as "room", never as the accent. */
const STRAIN_LOOSE_HEX = '#38BDF8';
const STRAIN_SNUG_HEX = '#F59E0B';
const STRAIN_IDEAL_HEX = '#10B981';
const STRAIN_CONSTRICTED_HEX = '#F43F5E';

/**
 * WebGL clearance / strain heatmap vertex colors (AGENTS.md §7):
 * blue / green / amber / red.
 */
export const strainHeatmap = {
  constricted: STRAIN_CONSTRICTED_HEX,
  snug: STRAIN_SNUG_HEX,
  ideal: STRAIN_IDEAL_HEX,
  loose: STRAIN_LOOSE_HEX,
  constrictedThreshold: 0.15,
} as const;

export type StrainHeatmapSwatch = 'constricted' | 'snug' | 'ideal' | 'loose';

export const typography = {
  sansFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  monoFamily: 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace',
  metricClassName: 'font-mono tabular-nums',
  labelClassName: 'text-[11px] font-semibold uppercase tracking-[0.12em] text-ash-subtle',
} as const;

export const spatialScale = {
  0.5: SPATIAL_GRID_PX / 2,
  1: SPATIAL_GRID_PX,
  2: SPATIAL_GRID_PX * 2,
  3: SPATIAL_GRID_PX * 3,
  4: SPATIAL_GRID_PX * 4,
  5: SPATIAL_GRID_PX * 5,
  6: SPATIAL_GRID_PX * 6,
} as const;

export interface Rgb01 {
  r: number;
  g: number;
  b: number;
}

const HEX_COLOR_PATTERN = /^#?([0-9A-Fa-f]{6})$/;

export function hexToRgb01(hex: string): Rgb01 {
  const match = HEX_COLOR_PATTERN.exec(hex);

  if (!match) {
    throw new Error(`Invalid hex color: ${hex}`);
  }

  const value = match[1];
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);

  return {
    r: red / 255,
    g: green / 255,
    b: blue / 255,
  };
}

export const strainHeatmapRgb: Record<StrainHeatmapSwatch, Rgb01> = {
  constricted: hexToRgb01(strainHeatmap.constricted),
  snug: hexToRgb01(strainHeatmap.snug),
  ideal: hexToRgb01(strainHeatmap.ideal),
  loose: hexToRgb01(strainHeatmap.loose),
};
