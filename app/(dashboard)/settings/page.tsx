import Link from 'next/link';

import { createClient } from '@/lib/supabase/server';
import { getCurrentTenantId } from '@/lib/supabase/tenant';

function getCurrentBillingPeriodStart(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function formatPlanTier(planTier: string): string {
  return `${planTier.charAt(0).toUpperCase()}${planTier.slice(1)}`;
}

export default async function SettingsPage() {
  const tenantId = await getCurrentTenantId();

  if (!tenantId) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl items-center p-6">
        <p className="rounded-xl border border-amber-700/50 bg-amber-950/30 p-6 text-sm text-amber-100">
          Tenant authentication is required to view usage settings.
        </p>
      </main>
    );
  }

  const supabase = await createClient();
  const billingPeriodStart = getCurrentBillingPeriodStart();
  const [{ data: merchant }, { data: meter }] = await Promise.all([
    supabase
      .from('merchants')
      .select('plan_tier, monthly_quota, overage_allowed')
      .eq('id', tenantId)
      .maybeSingle(),
    supabase
      .from('tenant_usage_meters')
      .select('fit_sessions_count')
      .eq('tenant_id', tenantId)
      .eq('billing_period_start', billingPeriodStart)
      .maybeSingle(),
  ]);

  const quota = merchant?.monthly_quota ?? 0;
  const sessionsUsed = meter?.fit_sessions_count ?? 0;
  const usagePercentage = quota > 0 ? Math.min((sessionsUsed / quota) * 100, 100) : 0;
  const isEnterprise = merchant?.plan_tier === 'enterprise';

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 p-6">
      <header>
        <p className="text-sm font-medium text-sky-300">Merchant Settings</p>
        <h1 className="mt-1 text-3xl font-bold text-slate-100">Usage & subscription</h1>
        <p className="mt-2 text-sm text-slate-400">
          Monitor your current billing-period fit-session usage.
        </p>
      </header>

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 shadow-lg backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-slate-400">Current subscription</p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-100">
              {merchant ? formatPlanTier(merchant.plan_tier) : 'Plan unavailable'}
            </h2>
          </div>
          <Link
            href="/settings/integrations"
            className="rounded-lg border border-sky-500/50 bg-sky-500/10 px-4 py-2 text-sm font-semibold text-sky-200 transition hover:border-sky-400 hover:bg-sky-500/20"
          >
            Manage integrations
          </Link>
        </div>

        <div className="mt-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-sm text-slate-400">Fit sessions used this month</p>
              <p className="mt-1 text-3xl font-semibold text-slate-100">
                {sessionsUsed.toLocaleString()}
                <span className="ml-2 text-base font-medium text-slate-400">
                  / {isEnterprise ? 'Unlimited with BYOK' : quota.toLocaleString()}
                </span>
              </p>
            </div>
            {!isEnterprise && merchant?.overage_allowed ? (
              <span className="rounded-full border border-emerald-700/60 bg-emerald-950/40 px-3 py-1 text-xs font-semibold text-emerald-200">
                Overage enabled
              </span>
            ) : null}
          </div>

          <div
            className="mt-4 h-3 overflow-hidden rounded-full bg-slate-800"
            role="progressbar"
            aria-label="Monthly fit-session usage"
            aria-valuemin={0}
            aria-valuemax={quota}
            aria-valuenow={sessionsUsed}
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-500 to-cyan-300 transition-[width]"
              style={{ width: `${usagePercentage}%` }}
            />
          </div>

          <p className="mt-3 text-sm text-slate-400">
            Billing period began {new Date(`${billingPeriodStart}T00:00:00Z`).toLocaleDateString()}.
          </p>
        </div>
      </section>
    </main>
  );
}
