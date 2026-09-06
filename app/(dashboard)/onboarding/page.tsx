import { redirect } from 'next/navigation';

import { OnboardingWizard } from '@/app/(dashboard)/onboarding/onboarding-wizard';
import { getShopifyConnectionStatus } from '@/lib/server/shopify-credentials';
import { createClient } from '@/lib/supabase/server';
import { getCurrentTenantId } from '@/lib/supabase/tenant';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage(): Promise<React.JSX.Element> {
  const tenantId = await getCurrentTenantId();

  if (!tenantId) {
    redirect('/sign-in');
  }

  const supabase = await createClient();
  const [{ data: tenant }, { count: garmentCount }, shopify] = await Promise.all([
    supabase
      .from('tenants')
      .select('company_name, allowed_domains')
      .eq('id', tenantId)
      .maybeSingle(),
    supabase
      .from('garment_cad_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId),
    getShopifyConnectionStatus(tenantId),
  ]);

  const appBaseUrl = process.env.APP_BASE_URL?.trim() ?? '';

  return (
    <OnboardingWizard
      companyName={tenant?.company_name ?? ''}
      initialDomains={tenant?.allowed_domains ?? []}
      shopifyConnected={shopify.connected}
      shopDomain={shopify.shopDomain}
      garmentCount={garmentCount ?? 0}
      platformUrl={appBaseUrl}
    />
  );
}
