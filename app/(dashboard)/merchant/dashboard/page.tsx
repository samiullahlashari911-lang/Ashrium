import Link from 'next/link';
import { redirect } from 'next/navigation';

import { EmptyState } from '@/components/dashboard/empty-state';
import { calculateReturnRateAnalytics } from '@/lib/analytics/return-rates';
import { getShopifyConnectionStatus } from '@/lib/server/shopify-credentials';
import { createClient } from '@/lib/supabase/server';
import { getCurrentTenantId } from '@/lib/supabase/tenant';

export const dynamic = 'force-dynamic';

const WINDOW_DAYS = 30;

function formatRate(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

function percentileSeconds(values: number[], fraction: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * (sorted.length - 1)))];
}

function formatSeconds(value: number | null): string {
  if (value === null) {
    return '—';
  }
  return value < 90 ? `${Math.round(value)}s` : `${(value / 60).toFixed(1)} min`;
}

type Readiness = { label: string; tone: 'ready' | 'approximate' | 'pending' };

function garmentReadiness(garment: {
  ingest_tier: number | null;
  approximate_fit: boolean;
  print_qa_passed: boolean;
}): Readiness {
  if (garment.ingest_tier === null) {
    return { label: 'Needs ingest', tone: 'pending' };
  }
  if (garment.approximate_fit || !garment.print_qa_passed) {
    return { label: 'Approximate', tone: 'approximate' };
  }
  return { label: 'Ready', tone: 'ready' };
}

const TONE_CLASS: Record<Readiness['tone'], string> = {
  ready: 'bg-ash-success-soft text-ash-success',
  approximate: 'bg-amber-50 text-amber-800',
  pending: 'bg-ash-raised text-ash-muted',
};

export default async function MerchantDashboardPage() {
  const tenantId = await getCurrentTenantId();

  if (!tenantId) {
    redirect('/sign-in');
  }

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const supabase = await createClient();
  const [
    { data: tenant },
    { data: telemetry },
    { data: garments, count: garmentCount },
    { count: tryOnCount },
    { count: avatarCount },
    shopify,
  ] = await Promise.all([
    supabase.from('tenants').select('company_name').eq('id', tenantId).maybeSingle(),
    supabase.from('store_telemetry').select('*').eq('tenant_id', tenantId),
    supabase
      .from('garment_cad_profiles')
      .select('id, sku, name, category, ingest_tier, approximate_fit, print_qa_passed, created_at', {
        count: 'exact',
      })
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(6),
    supabase
      .from('fit_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('created_at', since),
    supabase
      .from('fit_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'completed')
      .gte('created_at', since),
    getShopifyConnectionStatus(tenantId),
  ]);

  // Avatar time from submit to avatar. Best-effort: the timing column may not
  // exist on older databases, in which case the tile reads "—".
  let avatarSeconds: number[] = [];
  try {
    const { data: timed, error } = await supabase
      .from('fit_jobs')
      .select('created_at, completed_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', since)
      .not('completed_at', 'is', null)
      .limit(500);
    if (!error && timed) {
      avatarSeconds = timed
        .map((row) => (Date.parse(row.completed_at ?? '') - Date.parse(row.created_at)) / 1000)
        .filter((seconds) => Number.isFinite(seconds) && seconds > 0);
    }
  } catch {
    avatarSeconds = [];
  }

  const analytics = calculateReturnRateAnalytics(telemetry ?? []);
  const hasGarments = (garmentCount ?? 0) > 0;
  const hasTelemetry = analytics.totalOrders > 0;
  const medianAvatar = percentileSeconds(avatarSeconds, 0.5);
  const p95Avatar = percentileSeconds(avatarSeconds, 0.95);
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-ash-muted">{today}</p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-ash-ink">
            Welcome{tenant ? `, ${tenant.company_name}` : ''}
          </h1>
        </div>
        <div className="flex gap-2">
          <Link href="/sandbox" className="ash-cta-secondary">Open 3D sandbox</Link>
          <Link href="/dashboard/garments" className="ash-cta">Add a product</Link>
        </div>
      </header>

      <section aria-label={`Last ${WINDOW_DAYS} days`} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Try-ons" value={String(tryOnCount ?? 0)} hint={`Last ${WINDOW_DAYS} days`} />
        <MetricCard label="3D avatars built" value={String(avatarCount ?? 0)} hint={`Last ${WINDOW_DAYS} days`} />
        <MetricCard
          label="Avatar time"
          value={formatSeconds(medianAvatar)}
          hint={p95Avatar === null ? 'Median, submit to avatar' : `Median · p95 ${formatSeconds(p95Avatar)}`}
        />
        <MetricCard
          label="Size-related returns"
          value={hasTelemetry ? formatRate(analytics.sizeRelatedReductionPercentage) : '—'}
          hint={hasTelemetry ? 'Reduction vs. baseline' : 'Needs order telemetry'}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="ash-card flex flex-col gap-4 p-5" aria-labelledby="catalog-title">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 id="catalog-title" className="font-semibold text-ash-ink">Catalog</h2>
              <p className="text-sm text-ash-muted">
                {hasGarments ? `${garmentCount} products in the fitting room` : 'No products yet'}
              </p>
            </div>
            <Link href="/dashboard/garments" className="text-sm font-semibold text-ash-accent hover:underline">
              View all
            </Link>
          </div>
          {hasGarments ? (
            <ul className="divide-y divide-ash-line">
              {(garments ?? []).map((garment) => {
                const readiness = garmentReadiness(garment);
                return (
                  <li key={garment.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ash-ink">{garment.name}</p>
                      <p className="truncate text-xs text-ash-subtle">
                        {garment.sku}
                        {garment.category ? ` · ${garment.category}` : ''}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${TONE_CLASS[readiness.tone]}`}>
                      {readiness.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              title="No products in your fitting room"
              description="Paste a product URL or sync your Shopify catalog so shoppers have something to try on."
              action={{
                href: shopify.connected ? '/dashboard/garments' : '/settings/integrations',
                label: shopify.connected ? 'Add your first product' : 'Connect Shopify',
              }}
            />
          )}
        </section>

        <section className="flex flex-col gap-4" aria-label="Guarantee and setup">
          <div
            className={[
              'rounded-3xl p-5',
              hasTelemetry && analytics.guaranteeAchieved
                ? 'bg-ash-success-soft'
                : 'bg-ash-accent-soft',
            ].join(' ')}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ash-accent">Return guarantee</p>
            <p className="mt-2 text-lg font-semibold text-ash-ink">
              {!hasTelemetry
                ? 'Waiting for order data'
                : analytics.guaranteeAchieved
                  ? 'Guarantee achieved'
                  : 'In progress'}
            </p>
            <p className="mt-1 text-sm text-ash-muted">
              {!hasTelemetry
                ? 'Connect the telemetry webhook so we can measure returns with and without Ashrium.'
                : analytics.sizeRelatedReductionPercentage === null
                  ? 'More baseline and fitting-room orders are needed to evaluate the guarantee.'
                  : `${analytics.sizeRelatedReductionPercentage.toFixed(1)}% fewer size-related returns across ${analytics.totalVfrSessions} fitting-room sessions.`}
            </p>
            {!hasTelemetry ? (
              <Link href="/settings" className="mt-3 inline-block text-sm font-semibold text-ash-accent hover:underline">
                Set up telemetry
              </Link>
            ) : null}
          </div>

          <div className="ash-card flex flex-col gap-1 p-5">
            <p className="font-semibold text-ash-ink">Shopify</p>
            <p className="text-sm text-ash-muted">
              {shopify.connected
                ? 'Connected. The Try On button appears above Add to cart on products that are ready.'
                : 'Not connected yet. Connect your store to sync products and add the Try On button.'}
            </p>
            <Link
              href="/settings/integrations"
              className="mt-2 self-start text-sm font-semibold text-ash-accent hover:underline"
            >
              {shopify.connected ? 'Manage connection' : 'Connect Shopify'}
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }): React.JSX.Element {
  return (
    <article className="ash-card flex flex-col gap-1 p-4 sm:p-5">
      <p className="text-xs font-medium text-ash-muted sm:text-sm">{label}</p>
      <p className="text-2xl font-semibold tracking-tight text-ash-ink sm:text-3xl">{value}</p>
      <p className="text-[11px] text-ash-subtle">{hint}</p>
    </article>
  );
}
