import type { FC, ReactNode } from 'react';

import { merchantKpis } from '@/lib/dashboard/merchant-demo-metrics';
import { typography } from '@/lib/design-tokens';

interface MetricCardProps {
  label: string;
  value: string;
  detail: string;
  accent: 'accent' | 'success';
  children: ReactNode;
}

const MetricCard: FC<MetricCardProps> = ({ label, value, detail, accent, children }) => {
  const accentClass = accent === 'accent' ? 'text-obsidian-accent' : 'text-obsidian-success';

  return (
    <article className="min-h-44 rounded-lg border border-obsidian-hairline bg-obsidian-card p-4 shadow-card">
      <p className={typography.labelClassName}>{label}</p>
      <div className="mt-4 flex items-end justify-between gap-4">
        <p className={`${typography.metricClassName} text-3xl font-semibold tracking-[-0.04em] text-obsidian-ink`}>
          {value}
        </p>
        <span className={`mb-1 text-xs font-medium ${accentClass} ${typography.metricClassName}`}>
          {detail}
        </span>
      </div>
      <div className="mt-4">{children}</div>
    </article>
  );
};

export const MetricCardGrid: FC = () => (
  <section aria-label="Performance summary" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
    <MetricCard
      label={merchantKpis.overallReturnRate.label}
      value={merchantKpis.overallReturnRate.value}
      detail={merchantKpis.overallReturnRate.detail}
      accent={merchantKpis.overallReturnRate.accent}
    >
      <span className={`${typography.metricClassName} inline-flex rounded border border-obsidian-success/30 bg-obsidian-success/10 px-2 py-1 text-[10px] font-medium text-obsidian-success-muted`}>
        ✓ {merchantKpis.overallReturnRate.guaranteeLabel}: {merchantKpis.overallReturnRate.guaranteeThreshold}
      </span>
    </MetricCard>

    <MetricCard
      label={merchantKpis.sizeReturnDelta.label}
      value={merchantKpis.sizeReturnDelta.value}
      detail={merchantKpis.sizeReturnDelta.detail}
      accent={merchantKpis.sizeReturnDelta.accent}
    >
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-obsidian-hairline">
          <div
            className="h-full rounded-full bg-obsidian-accent"
            style={{ width: `${merchantKpis.sizeReturnDelta.confidencePercent}%` }}
          />
        </div>
        <span className={`${typography.metricClassName} text-[10px] text-obsidian-subtle`}>
          {merchantKpis.sizeReturnDelta.confidencePercent}% CONF.
        </span>
      </div>
    </MetricCard>

    <MetricCard
      label={merchantKpis.fitSessions.label}
      value={merchantKpis.fitSessions.value}
      detail={merchantKpis.fitSessions.detail}
      accent={merchantKpis.fitSessions.accent}
    >
      <div className={`${typography.metricClassName} flex items-center gap-2 text-[10px] text-obsidian-subtle`}>
        <span className="size-2 rounded-full bg-obsidian-accent shadow-[0_0_8px_#38BDF8]" />
        {merchantKpis.fitSessions.poolLabel}
      </div>
    </MetricCard>

    <MetricCard
      label={merchantKpis.retainedRevenue.label}
      value={merchantKpis.retainedRevenue.value}
      detail={merchantKpis.retainedRevenue.detail}
      accent={merchantKpis.retainedRevenue.accent}
    >
      <div className={`${typography.metricClassName} flex justify-between text-[10px] text-obsidian-subtle`}>
        <span>AVG: {merchantKpis.retainedRevenue.averageOrder}</span>
        <span>SAVED: {merchantKpis.retainedRevenue.unitsSaved}</span>
      </div>
    </MetricCard>
  </section>
);
