import Link from 'next/link';
import { redirect } from 'next/navigation';

import { EmptyState } from '@/components/dashboard/empty-state';
import { calculateReturnRateAnalytics } from '@/lib/analytics/return-rates';
import { getShopifyConnectionStatus } from '@/lib/server/shopify-credentials';
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
  const [{ data: tenant }, { data: telemetry }, { count: garmentCount }, shopify] =
    await Promise.all([
      supabase
        .from('tenants')
        .select('company_name')
        .eq('id', tenantId)
        .maybeSingle(),
      supabase.from('store_telemetry').select('*').eq('tenant_id', tenantId),
      supabase
        .from('garment_cad_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId),
      getShopifyConnectionStatus(tenantId),
    ]);

  const analytics = calculateReturnRateAnalytics(telemetry ?? []);
  const hasGarments = (garmentCount ?? 0) > 0;
  const hasTelemetry = analytics.totalOrders > 0;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 p-6">
      <header>
        <p className="text-sm font-medium text-obsidian-accent-muted">Merchant workspace</p>
        <h1 className="mt-1 text-3xl font-bold text-obsidian-ink">
          Welcome{tenant ? `, ${tenant.company_name}` : ''}
        </h1>
        <p className="mt-2 text-sm text-obsidian-muted">
          Monitor fit adoption and return-rate performance across your storefront.
        </p>
      </header>

      {hasTelemetry ? (
        <>
          <section
            className={`rounded-xl border p-5 ${
              analytics.guaranteeAchieved
                ? 'border-emerald-400/50 bg-emerald-500/10'
                : 'border-obsidian-accent/30 bg-obsidian-accent/10'
            }`}
          >
            <p className="text-sm font-semibold text-obsidian-ink">
              {analytics.guaranteeAchieved
                ? '20% size-related return reduction achieved'
                : 'Return-reduction guarantee in progress'}
            </p>
            <p className="mt-1 text-sm text-obsidian-muted">
              {analytics.sizeRelatedReductionPercentage === null
                ? 'More baseline and VFR order data is required to evaluate the guarantee.'
                : `${analytics.sizeRelatedReductionPercentage.toFixed(2)}% size-related return reduction measured.`}
            </p>
          </section>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCard label="Total orders" value={String(analytics.totalOrders)} />
            <MetricCard label="VFR sessions" value={String(analytics.totalVfrSessions)} />
            <MetricCard
              label="Baseline return rate"
              value={formatRate(analytics.baselineReturnRate)}
            />
            <MetricCard label="VFR return rate" value={formatRate(analytics.vfrReturnRate)} />
            <MetricCard
              label="Size-related reduction"
              value={formatRate(analytics.sizeRelatedReductionPercentage)}
            />
          </section>
        </>
      ) : (
        <EmptyState
          title="No telemetry yet"
          description="Return-rate reporting appears once your store posts order and return events to the Ashrium telemetry webhook."
          action={{ href: '/settings', label: 'Set up the telemetry webhook' }}
        />
      )}

      {hasGarments ? null : (
        <EmptyState
          title="No garments in your library"
          description="Sync your Shopify catalog or create a CAD profile by hand so the fitting room has something to drape."
          action={{
            href: shopify.connected ? '/dashboard/garments' : '/settings/integrations',
            label: shopify.connected ? 'Sync your catalog' : 'Connect Shopify',
          }}
        />
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Link
          href="/sandbox"
          className="obsidian-glass p-5 transition hover:border-obsidian-accent/60 hover:bg-white/[0.09]"
        >
          <h2 className="font-semibold text-obsidian-ink">3D Sandbox</h2>
          <p className="mt-2 text-sm text-obsidian-muted">
            First-party capture preview. Not storefront go-live.
          </p>
        </Link>
        <Link
          href="/dashboard/garments"
          className="obsidian-glass p-5 transition hover:border-obsidian-accent/60 hover:bg-white/[0.09]"
        >
          <h2 className="font-semibold text-obsidian-ink">Garment library</h2>
          <p className="mt-2 text-sm text-obsidian-muted">Manage tenant-scoped CAD profiles.</p>
        </Link>
        <Link
          href="/settings"
          className="obsidian-glass p-5 transition hover:border-obsidian-accent/60 hover:bg-white/[0.09]"
        >
          <h2 className="font-semibold text-obsidian-ink">Usage & settings</h2>
          <p className="mt-2 text-sm text-obsidian-muted">
            Review consumption, storefront domains, and telemetry.
          </p>
        </Link>
      </div>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <article className="obsidian-glass p-5">
      <p className="text-sm font-medium text-obsidian-muted">{label}</p>
      <p className="mt-2 text-3xl font-bold text-obsidian-ink">{value}</p>
    </article>
  );
}
