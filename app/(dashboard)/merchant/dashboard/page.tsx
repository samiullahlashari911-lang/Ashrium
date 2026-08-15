import Link from 'next/link';
import { redirect } from 'next/navigation';

import { calculateReturnRateAnalytics } from '@/lib/analytics/return-rates';
import { createClient } from '@/lib/supabase/server';
import { getCurrentTenantId } from '@/lib/supabase/tenant';

export const dynamic = 'force-dynamic';

function formatRate(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}%`;
}

export default async function MerchantDashboardPage() {
  const tenantId = await getCurrentTenantId();

  if (!tenantId) {
    redirect('/sign-in');
  }

  const supabase = await createClient();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('company_name')
    .eq('id', tenantId)
    .maybeSingle();
  const { data: telemetry } = await supabase
    .from('store_telemetry')
    .select('*')
    .eq('tenant_id', tenantId);
  const analytics = calculateReturnRateAnalytics(telemetry ?? []);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 p-6">
      <header>
        <p className="text-sm font-medium text-sky-300">Merchant workspace</p>
        <h1 className="mt-1 text-3xl font-bold text-slate-100">
          Welcome{tenant ? `, ${tenant.company_name}` : ''}
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Monitor fit adoption and return-rate performance across your storefront.
        </p>
      </header>

      <section
        className={`rounded-xl border p-5 ${
          analytics.guaranteeAchieved
            ? 'border-emerald-400/50 bg-emerald-500/10'
            : 'border-sky-500/30 bg-sky-500/10'
        }`}
      >
        <p className="text-sm font-semibold text-slate-100">
          {analytics.guaranteeAchieved
            ? '20% size-related return reduction achieved'
            : 'Return-reduction guarantee in progress'}
        </p>
        <p className="mt-1 text-sm text-slate-300">
          {analytics.sizeRelatedReductionPercentage === null
            ? 'More baseline and VFR order data is required to evaluate the guarantee.'
            : `${analytics.sizeRelatedReductionPercentage.toFixed(2)}% size-related return reduction measured.`}
        </p>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Total orders" value={String(analytics.totalOrders)} />
        <MetricCard label="VFR sessions" value={String(analytics.totalVfrSessions)} />
        <MetricCard label="Baseline return rate" value={formatRate(analytics.baselineReturnRate)} />
        <MetricCard label="VFR return rate" value={formatRate(analytics.vfrReturnRate)} />
        <MetricCard
          label="Size-related reduction"
          value={formatRate(analytics.sizeRelatedReductionPercentage)}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Link
          href="/sandbox"
          className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg transition hover:border-sky-500/60 hover:bg-slate-900/80"
        >
          <h2 className="font-semibold text-slate-100">3D Sandbox</h2>
          <p className="mt-2 text-sm text-slate-400">Test fit, drape, and strain heatmaps.</p>
        </Link>
        <Link
          href="/dashboard/garments"
          className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg transition hover:border-sky-500/60 hover:bg-slate-900/80"
        >
          <h2 className="font-semibold text-slate-100">Garment library</h2>
          <p className="mt-2 text-sm text-slate-400">Manage tenant-scoped CAD profiles.</p>
        </Link>
        <Link
          href="/settings"
          className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg transition hover:border-sky-500/60 hover:bg-slate-900/80"
        >
          <h2 className="font-semibold text-slate-100">Usage & quotas</h2>
          <p className="mt-2 text-sm text-slate-400">Review fit-session consumption and plan data.</p>
        </Link>
      </div>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg">
      <p className="text-sm font-medium text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-bold text-slate-100">{value}</p>
    </article>
  );
}
