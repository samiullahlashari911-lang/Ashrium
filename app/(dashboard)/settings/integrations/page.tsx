import Link from 'next/link';
import { Suspense } from 'react';

import { ShopifyForm } from '@/app/(dashboard)/settings/integrations/shopify-form';
import { getShopifyConnectionStatus } from '@/lib/server/shopify-credentials';
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

  const shopify = await getShopifyConnectionStatus(tenantId);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 p-6">
      <header>
        <Link href="/settings" className="text-sm font-medium text-obsidian-accent-muted hover:text-obsidian-ink">
          ← Usage & subscription
        </Link>
        <h1 className="mt-3 text-3xl font-bold text-obsidian-ink">Integrations</h1>
        <p className="mt-2 text-sm text-obsidian-muted">
          Configure server-side providers for your merchant account.
        </p>
      </header>

      <Suspense
        fallback={
          <section className="obsidian-glass p-6 text-sm text-obsidian-muted">
            Loading Shopify integration…
          </section>
        }
      >
        <ShopifyForm
          connected={shopify.connected}
          shopDomain={shopify.shopDomain}
          usesOAuth={shopify.usesOAuth}
        />
      </Suspense>

      <section className="obsidian-glass p-6">
        <h2 className="text-lg font-semibold text-obsidian-ink">Fitting GPU</h2>
        <p className="mt-2 text-sm text-obsidian-muted">
          Avatar, drape, and pattern ingest run on Ashrium&apos;s Modal A100-80GB. Merchants
          do not bring their own GPU keys.
        </p>
      </section>
    </main>
  );
}
