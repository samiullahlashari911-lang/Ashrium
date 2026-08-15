/**
 * Obsidian Titanium design system — single source of truth for merchant UI,
 * WebGL strain heatmaps, and 8px spatial rhythm.
 */

export const SPATIAL_GRID_PX = 8 as const;

export const obsidianTitanium = {
  canvas: '#090D14',
  card: '#111827',
  hairline: '#1F2937',
  accent: '#38BDF8',
  success: '#10B981',
  tension: '#F43F5E',
  ink: '#F1F5F9',
  muted: '#94A3B8',
  subtle: '#64748B',
  accentMuted: '#7DD3FC',
  successMuted: '#6EE7B7',
  tensionMuted: '#FDA4AF',
} as const;

export type ObsidianTitaniumColor = (typeof obsidianTitanium)[keyof typeof obsidianTitanium];

/**
 * WebGL strain heatmap vertex colors (AGENTS.md §5):
 * - Constricted: tension > 15% stretch
 * - Ideal: contour fit
 * - Loose: zero pressure / folds
 */
export const strainHeatmap = {
  constricted: obsidianTitanium.tension,
  ideal: obsidianTitanium.success,
  loose: obsidianTitanium.accent,
  constrictedThreshold: 0.15,
} as const;

export type StrainHeatmapSwatch = 'constricted' | 'ideal' | 'loose';

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
  ideal: hexToRgb01(strainHeatmap.ideal),
  loose: hexToRgb01(strainHeatmap.loose),
};
