import { RADIAL_HEATMAP_SWATCHES } from '@/lib/graphics/radial-heatmap';

export function RadialHeatmapLegend(): React.JSX.Element {
  return (
    <aside
      className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-2xl border border-white/12 bg-obsidian-canvas/70 px-3 py-2.5 backdrop-blur-md"
      aria-label="Fit heatmap legend"
    >
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-obsidian-subtle">
        Fit heatmap
      </p>
      <ul className="flex flex-col gap-1">
        {RADIAL_HEATMAP_SWATCHES.map((swatch) => (
          <li key={swatch.label} className="flex items-center gap-2 text-[11px] text-obsidian-muted">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: swatch.color }}
            />
            {swatch.label}
          </li>
        ))}
      </ul>
    </aside>
  );
}
