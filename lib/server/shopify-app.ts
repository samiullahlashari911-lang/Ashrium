import { decryptTenantSecret } from '@/lib/server/secret-crypto';
import {
  getShopifyOAuthConfig,
  getShopifyOAuthRedirectUri,
  SHOPIFY_CLIENT_APP_SCOPES,
  type ShopifyOAuthConfig,
} from '@/lib/server/shopify-oauth';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Which Shopify app a tenant connects through. Each client has its own
 * custom-distribution app (client:new); the shared app from env is the
 * fallback for tenants created before that (the owner's demo tenant).
 */
interface ShopifyAppRow {
  tenant_id: string;
  shopify_shop_domain: string | null;
  shopify_app_client_id: string | null;
  shopify_app_client_secret_ciphertext: string | null;
  is_active: boolean;
}

const APP_ROW_COLUMNS =
  'tenant_id, shopify_shop_domain, shopify_app_client_id, shopify_app_client_secret_ciphertext, is_active';

function appFromRow(row: ShopifyAppRow | null): ShopifyOAuthConfig {
  if (row?.shopify_app_client_id && row.shopify_app_client_secret_ciphertext) {
    const clientSecret = decryptTenantSecret(row.shopify_app_client_secret_ciphertext);
    if (!clientSecret) {
      throw new Error('This client\'s Shopify app secret could not be decrypted. Re-run client:new.');
    }
    return {
      clientId: row.shopify_app_client_id,
      clientSecret,
      redirectUri: getShopifyOAuthRedirectUri(),
      scopes: SHOPIFY_CLIENT_APP_SCOPES,
      perClient: true,
    };
  }
  return getShopifyOAuthConfig();
}

export async function shopifyAppForTenant(tenantId: string): Promise<ShopifyOAuthConfig> {
  const { data } = await createServiceClient()
    .from('tenant_integrations')
    .select(APP_ROW_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('provider', 'shopify')
    .maybeSingle();
  return appFromRow(data);
}

/**
 * The tenant and app registered for a shop (installs and webhooks arrive with
 * only the shop domain). Null when no tenant claims the shop.
 */
export async function shopifyAppForShop(
  shopDomain: string,
): Promise<{ tenantId: string; app: ShopifyOAuthConfig } | null> {
  const { data } = await createServiceClient()
    .from('tenant_integrations')
    .select(APP_ROW_COLUMNS)
    .eq('provider', 'shopify')
    .eq('shopify_shop_domain', shopDomain.toLowerCase())
    .limit(2);

  // A shop claimed by two tenants is ambiguous; refuse rather than guess.
  if (!data || data.length !== 1 || !data[0]) {
    return null;
  }
  return { tenantId: data[0].tenant_id, app: appFromRow(data[0]) };
}
