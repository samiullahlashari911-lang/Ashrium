/**
 * Obsidian design system — single source of truth for merchant UI,
 * widget chrome, WebGL strain heatmaps, and 8px spatial rhythm.
 *
 * Palette: glass indigo / magenta merchant portal (deep canvas, frosted
 * panels, purple→magenta CTAs). Strain heatmap swatches stay independent
 * of the UI accent so cloth visualization is unchanged.
 */

export const SPATIAL_GRID_PX = 8 as const;

export const obsidianTitanium = {
  canvas: '#0B0B1E',
  canvasLift: '#1A1A2E',
  card: '#16162B',
  hairline: '#2A2A48',
  accent: '#6A32C9',
  accentEnd: '#B52286',
  success: '#10B981',
  tension: '#F43F5E',
  ink: '#F8FAFC',
  muted: '#A1A1B8',
  subtle: '#7B7B96',
  accentMuted: '#C4B5FD',
  successMuted: '#6EE7B7',
  tensionMuted: '#FDA4AF',
} as const;

export type ObsidianTitaniumColor = (typeof obsidianTitanium)[keyof typeof obsidianTitanium];

/** Frosted-glass recipe used by `.obsidian-glass` in globals.css. */
export const glassTokens = {
  fill: 'rgba(255, 255, 255, 0.07)',
  border: 'rgba(255, 255, 255, 0.12)',
  blurPx: 20,
  /** Dashboard sets `backdrop-filter: none` via `.dashboard-surface`. */
  dashboardBlurPx: 0,
  radiusPx: 28,
} as const;

export const gradientTokens = {
  cta: `linear-gradient(90deg, ${obsidianTitanium.accent} 0%, ${obsidianTitanium.accentEnd} 100%)`,
  canvas: `linear-gradient(180deg, ${obsidianTitanium.canvas} 0%, ${obsidianTitanium.canvasLift} 100%)`,
} as const;

/**
 * CSS class names owned by this token module (`app/globals.css`).
 * Prefer these over raw slate/sky utilities.
 */
export const themeClasses = {
  glass: 'obsidian-glass',
  cta: 'obsidian-cta',
  input: 'obsidian-input',
  inputBox: 'obsidian-input-box',
} as const;

/** Kept as sky blue so strain viz does not follow the purple UI accent. */
const STRAIN_LOOSE_HEX = '#38BDF8';
const STRAIN_SNUG_HEX = '#F59E0B';

/**
 * WebGL strain heatmap vertex colors (AGENTS.md §7):
 * blue / green / amber / red.
 */
export const strainHeatmap = {
  constricted: obsidianTitanium.tension,
  snug: STRAIN_SNUG_HEX,
  ideal: obsidianTitanium.success,
  loose: STRAIN_LOOSE_HEX,
  constrictedThreshold: 0.15,
} as const;

export type StrainHeatmapSwatch = 'constricted' | 'snug' | 'ideal' | 'loose';

export const typography = {
  sansFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  monoFamily: 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace',
  metricClassName: 'font-mono tabular-nums',
  labelClassName: 'text-[11px] font-semibold uppercase tracking-[0.12em] text-obsidian-subtle',
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
