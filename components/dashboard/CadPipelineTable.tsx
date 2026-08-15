import type { FC } from 'react';

import { cadPipelineRows, type CadPipelineRow } from '@/lib/dashboard/merchant-demo-metrics';
import { strainHeatmap, typography } from '@/lib/design-tokens';

const statusClasses: Record<CadPipelineRow['status'], string> = {
  Ready: 'border-obsidian-success/30 bg-obsidian-success/10 text-obsidian-success-muted',
  Processing: 'border-obsidian-accent/30 bg-obsidian-accent/10 text-obsidian-accent-muted',
  Review: 'border-obsidian-tension/30 bg-obsidian-tension/10 text-obsidian-tension-muted',
};

const strainLegend = [
  { label: 'Constricted >15%', swatch: strainHeatmap.constricted },
  { label: 'Ideal contour', swatch: strainHeatmap.ideal },
  { label: 'Loose folds', swatch: strainHeatmap.loose },
] as const;

export const CadPipelineTable: FC = () => (
  <section className="rounded-lg border border-obsidian-hairline bg-obsidian-card">
    <header className="flex flex-col gap-4 border-b border-obsidian-hairline p-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <p className={typography.labelClassName}>CAD management pipeline</p>
        <h2 className="mt-2 text-base font-semibold text-obsidian-ink">Sewformer / SPnet extraction</h2>
        <p className="mt-1 text-xs text-obsidian-subtle">Latest tenant-scoped garment mechanical profiles.</p>
        <ul className="mt-4 flex flex-wrap gap-4">
          {strainLegend.map((item) => (
            <li
              key={item.label}
              className={`${typography.metricClassName} flex items-center gap-2 text-[10px] text-obsidian-subtle`}
            >
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ backgroundColor: item.swatch }}
              />
              {item.label}
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        className="h-10 shrink-0 rounded-lg border border-obsidian-accent/40 bg-obsidian-accent/10 px-4 text-[11px] font-semibold uppercase tracking-wide text-obsidian-accent-muted transition hover:bg-obsidian-accent/20"
      >
        + Ingest
      </button>
    </header>

    <div className="overflow-x-auto">
      <table className="min-w-[760px] w-full text-left">
        <thead className="border-b border-obsidian-hairline">
          <tr className="text-[10px] font-semibold uppercase tracking-[0.1em] text-obsidian-subtle">
            <th className="px-4 py-3">SKU / garment</th>
            <th className="px-4 py-3">Pipeline</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Mesh profile</th>
            <th className="px-4 py-3"><i>S</i><sub>t</sub></th>
            <th className="px-4 py-3"><i>B</i><sub>r</sub></th>
          </tr>
        </thead>
        <tbody>
          {cadPipelineRows.map((row) => (
            <tr key={row.sku} className="border-b border-obsidian-hairline/80 last:border-0 hover:bg-obsidian-canvas/60">
              <td className="px-4 py-3">
                <p className={`${typography.metricClassName} text-xs text-obsidian-ink`}>{row.sku}</p>
                <p className="mt-1 text-xs text-obsidian-subtle">{row.garment}</p>
              </td>
              <td className="px-4 py-3 text-xs text-obsidian-muted">{row.pipeline}</td>
              <td className="px-4 py-3">
                <span className={`${typography.metricClassName} rounded border px-2 py-1 text-[10px] ${statusClasses[row.status]}`}>
                  {row.status}
                </span>
              </td>
              <td className={`${typography.metricClassName} px-4 py-3 text-xs text-obsidian-muted`}>{row.mesh}</td>
              <td className={`${typography.metricClassName} px-4 py-3 text-xs text-obsidian-muted`}>{row.tensileStiffness}</td>
              <td className={`${typography.metricClassName} px-4 py-3 text-xs text-obsidian-muted`}>{row.bendingRigidity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
);
