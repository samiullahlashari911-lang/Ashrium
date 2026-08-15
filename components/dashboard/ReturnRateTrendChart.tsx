import type { FC } from 'react';

import { merchantTrend } from '@/lib/dashboard/merchant-demo-metrics';
import { obsidianTitanium, typography } from '@/lib/design-tokens';

const gridLines = [24, 72, 120, 168] as const;

export const ReturnRateTrendChart: FC = () => (
  <section className="rounded-lg border border-obsidian-hairline bg-obsidian-card p-4 lg:p-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p className={typography.labelClassName}>Return rate trend</p>
        <h2 className="mt-2 text-base font-semibold text-obsidian-ink">
          Weekly return rate by fit experience
        </h2>
        <p className="mt-1 text-xs text-obsidian-subtle">
          A lower rate reflects a successful recommendation outcome.
        </p>
      </div>
      <div className={`${typography.metricClassName} flex items-center gap-4 text-[10px] uppercase tracking-wide text-obsidian-subtle`}>
        <span className="flex items-center gap-2">
          <span className="h-px w-4 bg-obsidian-subtle" /> Baseline {merchantTrend.baselineRate}
        </span>
        <span className="flex items-center gap-2">
          <span className="h-px w-4 bg-obsidian-accent" /> Ashrium VFR {merchantTrend.vfrRate}
        </span>
      </div>
    </div>

    <div className="mt-6 overflow-x-auto">
      <svg
        aria-label="Return rate trend chart showing Ashrium VFR below the baseline return rate"
        className="h-56 min-w-[624px] w-full"
        role="img"
        viewBox="0 0 720 232"
      >
        {gridLines.map((line) => (
          <line
            key={line}
            x1="50"
            x2="700"
            y1={line}
            y2={line}
            stroke={obsidianTitanium.hairline}
            strokeWidth="1"
          />
        ))}
        <text x="4" y="28" fill={obsidianTitanium.subtle} fontSize="10" fontFamily={typography.monoFamily}>
          20%
        </text>
        <text x="4" y="76" fill={obsidianTitanium.subtle} fontSize="10" fontFamily={typography.monoFamily}>
          18%
        </text>
        <text x="4" y="124" fill={obsidianTitanium.subtle} fontSize="10" fontFamily={typography.monoFamily}>
          16%
        </text>
        <text x="4" y="172" fill={obsidianTitanium.subtle} fontSize="10" fontFamily={typography.monoFamily}>
          14%
        </text>

        <path
          d="M52 60 C82 48, 102 69, 132 57 S182 49, 212 62 S262 48, 292 54 S342 58, 372 48 S422 57, 452 52 S502 43, 532 53 S582 50, 612 45 S662 52, 698 43"
          fill="none"
          stroke={obsidianTitanium.subtle}
          strokeDasharray="4 5"
          strokeWidth="2"
        />
        <path
          d="M52 142 C82 138, 102 149, 132 143 S182 139, 212 151 S262 146, 292 158 S342 154, 372 165 S422 159, 452 170 S502 163, 532 174 S582 168, 612 180 S662 174, 698 183"
          fill="none"
          stroke={obsidianTitanium.accent}
          strokeWidth="2.5"
        />
        <circle cx="698" cy="183" r="4" fill={obsidianTitanium.accent} />
        <text
          x="650"
          y="199"
          fill={obsidianTitanium.accent}
          fontFamily={typography.monoFamily}
          fontSize="10"
        >
          {merchantTrend.vfrRate}
        </text>

        {merchantTrend.months.map((month, index) => (
          <text
            key={month}
            x={54 + index * 210}
            y="220"
            fill={obsidianTitanium.subtle}
            fontFamily={typography.monoFamily}
            fontSize="10"
          >
            {month}
          </text>
        ))}
      </svg>
    </div>
  </section>
);
