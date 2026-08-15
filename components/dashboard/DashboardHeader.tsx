'use client';

import { useState, type FC } from 'react';

import {
  formatMerchantTimestamp,
  merchantDateRanges,
  merchantLastSyncIso,
  merchantStores,
  type MerchantDateRange,
  type MerchantStore,
} from '@/lib/dashboard/merchant-demo-metrics';
import { typography } from '@/lib/design-tokens';

export const DashboardHeader: FC = () => {
  const [store, setStore] = useState<MerchantStore>(merchantStores[0]);
  const [dateRange, setDateRange] = useState<MerchantDateRange>(merchantDateRanges[0]);

  return (
    <header className="flex flex-col gap-4 border-b border-obsidian-hairline pb-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-center gap-4">
        <div
          aria-hidden="true"
          className="grid size-10 place-items-center rounded-lg border border-obsidian-accent/40 bg-obsidian-accent/10 text-lg text-obsidian-accent"
        >
          ◆
        </div>
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold tracking-[0.18em] text-obsidian-ink">ASHRIUM</span>
            <span className="text-sm text-obsidian-subtle">/</span>
            <span className="text-sm font-medium text-obsidian-muted">Analytics</span>
          </div>
          <p className={`mt-1 text-xs text-obsidian-subtle ${typography.metricClassName}`}>
            Last sync {formatMerchantTimestamp(merchantLastSyncIso)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="merchant-store">
          Merchant store
        </label>
        <select
          id="merchant-store"
          value={store}
          onChange={(event) => setStore(event.target.value as MerchantStore)}
          className="h-10 rounded-lg border border-obsidian-hairline bg-obsidian-card px-4 text-xs font-medium text-obsidian-ink outline-none transition focus:border-obsidian-accent"
        >
          {merchantStores.map((storeOption) => (
            <option key={storeOption} value={storeOption}>
              {storeOption}
            </option>
          ))}
        </select>

        <div className="flex h-10 items-center gap-2 rounded-lg border border-obsidian-hairline bg-obsidian-card px-4 text-xs text-obsidian-success-muted">
          <span className="size-2 rounded-full bg-obsidian-success shadow-[0_0_8px_#10B981]" />
          Shopify active
        </div>

        <label className="sr-only" htmlFor="merchant-date-range">
          Date range
        </label>
        <select
          id="merchant-date-range"
          value={dateRange}
          onChange={(event) => setDateRange(event.target.value as MerchantDateRange)}
          className="h-10 rounded-lg border border-obsidian-hairline bg-obsidian-card px-4 text-xs font-medium text-obsidian-muted outline-none transition hover:text-obsidian-ink focus:border-obsidian-accent"
        >
          {merchantDateRanges.map((range) => (
            <option key={range} value={range}>
              {range}
            </option>
          ))}
        </select>

        <button
          type="button"
          aria-label="Open dashboard settings"
          className="grid size-10 place-items-center rounded-lg border border-obsidian-hairline bg-obsidian-card text-obsidian-subtle transition hover:border-obsidian-muted hover:text-obsidian-ink"
        >
          <span aria-hidden="true">⚙</span>
        </button>
      </div>
    </header>
  );
};
