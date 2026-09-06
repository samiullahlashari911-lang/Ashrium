import { decryptTenantSecret, encryptTenantSecret } from '@/lib/server/secret-crypto';
import { verifyShopifyAdminCredentials } from '@/lib/catalog/shopify-admin';
import { createServiceClient } from '@/lib/supabase/service';
import { requireCurrentTenantId } from '@/lib/supabase/tenant';

export interface ShopifyConnectionStatus {
  connected: boolean;
  shopDomain: string | null;
}

export interface SaveShopifyCredentialsResult {
  success: boolean;
  message: string;
  shopDomain: string;
}

const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

function normalizeShopifyShopDomain(raw: string): string | null {
  let value = raw.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!value.includes('.')) {
    value = `${value}.myshopify.com`;
  }

  return SHOP_DOMAIN_PATTERN.test(value) ? value : null;
}

export async function loadShopifyCredentials(
  tenantId: string,
): Promise<{ shopDomain: string; adminToken: string } | null> {
  const currentTenantId = await requireCurrentTenantId();
  if (currentTenantId !== tenantId) {
    return null;
  }

  const serviceClient = createServiceClient();
  const { data, error } = await serviceClient
    .from('tenant_integrations')
    .select('shopify_shop_domain, shopify_admin_token_ciphertext, is_active')
    .eq('tenant_id', tenantId)
    .eq('provider', 'shopify')
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data?.shopify_shop_domain || !data.shopify_admin_token_ciphertext) {
    return null;
  }

  const adminToken = decryptTenantSecret(data.shopify_admin_token_ciphertext);
  if (!adminToken) {
    return null;
  }

  return { shopDomain: data.shopify_shop_domain, adminToken };
}

export async function getShopifyConnectionStatus(
  tenantId: string,
): Promise<ShopifyConnectionStatus> {
  const serviceClient = createServiceClient();
  const { data } = await serviceClient
    .from('tenant_integrations')
    .select('shopify_shop_domain, is_active')
    .eq('tenant_id', tenantId)
    .eq('provider', 'shopify')
    .eq('is_active', true)
    .maybeSingle();

  return {
    connected: Boolean(data?.shopify_shop_domain),
    shopDomain: data?.shopify_shop_domain ?? null,
  };
}

export async function saveMerchantShopifyCredentials(
  shopDomainInput: string,
  adminTokenInput: string,
): Promise<SaveShopifyCredentialsResult> {
  const shopDomain = normalizeShopifyShopDomain(shopDomainInput);
  const adminToken = adminTokenInput.trim();

  if (!shopDomain) {
    return {
      success: false,
      message: 'Enter a myshopify.com shop domain.',
      shopDomain: '',
    };
  }

  if (adminToken.length < 10 || adminToken.length > 256) {
    return {
      success: false,
      message: 'Enter a Shopify Admin API access token.',
      shopDomain,
    };
  }

  try {
    await requireCurrentTenantId();
  } catch {
    return {
      success: false,
      message: 'Sign in with an active merchant account.',
      shopDomain,
    };
  }

  try {
    const identity = await verifyShopifyAdminCredentials({ shopDomain, adminToken });
    if (identity.myshopifyDomain !== shopDomain) {
      return {
        success: false,
        message: `Token belongs to ${identity.myshopifyDomain}, not ${shopDomain}.`,
        shopDomain,
      };
    }
  } catch {
    return {
      success: false,
      message: 'Shopify rejected this shop domain or Admin token.',
      shopDomain,
    };
  }

  const tenantId = await requireCurrentTenantId();
  const serviceClient = createServiceClient();
  const { error } = await serviceClient.from('tenant_integrations').upsert(
    {
      tenant_id: tenantId,
      provider: 'shopify',
      shopify_shop_domain: shopDomain,
      shopify_admin_token_ciphertext: encryptTenantSecret(adminToken),
      is_active: true,
    },
    { onConflict: 'tenant_id,provider' },
  );

  if (error) {
    return {
      success: false,
      message: 'Unable to save the Shopify integration.',
      shopDomain,
    };
  }

  return {
    success: true,
    message: `Connected to ${shopDomain}. Test one SKU on Garments — full catalog sync is optional.`,
    shopDomain,
  };
}
