import { evaluateStorefrontGoLive, type StorefrontGoLiveStatus } from '@/lib/onboarding';
import { getShopifyConnectionStatus } from '@/lib/server/shopify-credentials';
import { createClient } from '@/lib/supabase/server';

export async function loadStorefrontGoLiveStatus(
  tenantId: string,
): Promise<StorefrontGoLiveStatus> {
  const supabase = await createClient();
  const [{ data: tenant }, { count: garmentCount }, shopify] = await Promise.all([
    supabase
      .from('tenants')
      .select('allowed_domains')
      .eq('id', tenantId)
      .maybeSingle(),
    supabase
      .from('garment_cad_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId),
    getShopifyConnectionStatus(tenantId),
  ]);

  return evaluateStorefrontGoLive({
    allowedDomains: tenant?.allowed_domains,
    garmentCount: garmentCount ?? 0,
    platformUrl: process.env.APP_BASE_URL?.trim() ?? '',
    shopDomain: shopify.shopDomain,
    shopifyConnected: shopify.connected,
  });
}
