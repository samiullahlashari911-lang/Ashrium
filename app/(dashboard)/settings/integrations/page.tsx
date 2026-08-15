import Link from 'next/link';

import { ReplicateKeyForm } from '@/app/(dashboard)/settings/integrations/replicate-key-form';
import { createServiceClient } from '@/lib/supabase/service';
import { createClient } from '@/lib/supabase/server';
import { getCurrentTenantId } from '@/lib/supabase/tenant';

export default async function IntegrationsPage() {
  const tenantId = await getCurrentTenantId();

  if (!tenantId) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl items-center p-6">
        <p className="rounded-xl border border-amber-700/50 bg-amber-950/30 p-6 text-sm text-amber-100">
          Tenant authentication is required to manage integrations.
        </p>
      </main>
    );
  }

  const tenantClient = await createClient();
  const { data: merchant } = await tenantClient
    .from('merchants')
    .select('plan_tier')
    .eq('id', tenantId)
    .maybeSingle();

  const isEnterprise = merchant?.plan_tier === 'enterprise';
  let hasActiveKey = false;

  if (isEnterprise) {
    const serviceClient = createServiceClient();
    const { data: integration } = await serviceClient
      .from('tenant_integrations')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('provider', 'replicate')
      .eq('is_active', true)
      .maybeSingle();

    hasActiveKey = integration !== null;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 p-6">
      <header>
        <Link href="/settings" className="text-sm font-medium text-sky-300 hover:text-sky-200">
          ← Usage & subscription
        </Link>
        <h1 className="mt-3 text-3xl font-bold text-slate-100">Integrations</h1>
        <p className="mt-2 text-sm text-slate-400">
          Configure server-side providers for your merchant account.
        </p>
      </header>

      {isEnterprise ? (
        <ReplicateKeyForm hasActiveKey={hasActiveKey} />
      ) : (
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 shadow-lg backdrop-blur">
          <h2 className="text-lg font-semibold text-slate-100">Replicate BYOK</h2>
          <p className="mt-2 text-sm text-slate-400">
            Bring-your-own Replicate keys are available on Enterprise plans. Upgrade your
            subscription to enable merchant-managed GPU billing and unlimited platform usage.
          </p>
        </section>
      )}
    </main>
  );
}
