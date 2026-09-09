import { decryptTenantSecret, encryptTenantSecret } from '@/lib/server/secret-crypto';
import {
  normalizeShopifyShopDomain,
  refreshShopifyAccessToken,
  saveShopifyOAuthTokens,
  shopifyAccessTokenNeedsRefresh,
} from '@/lib/server/shopify-oauth';
import {
  assertShopifyReadProductsAccess,
  ShopifyAccessScopeError,
  verifyShopifyAdminCredentials,
} from '@/lib/catalog/shopify-admin';
import { createServiceClient } from '@/lib/supabase/service';
import { requireCurrentTenantId } from '@/lib/supabase/tenant';

export { normalizeShopifyShopDomain };

export interface ShopifyConnectionStatus {
  connected: boolean;
  shopDomain: string | null;
  tokenExpiresAt: string | null;
  usesOAuth: boolean;
}

export interface SaveShopifyCredentialsResult {
  success: boolean;
  message: string;
  shopDomain: string;
}

export interface DisconnectShopifyResult {
  success: boolean;
  message: string;
}

interface ShopifyIntegrationRow {
  shopify_shop_domain: string | null;
  shopify_admin_token_ciphertext: string | null;
  shopify_token_expires_at: string | null;
  shopify_refresh_token_ciphertext: string | null;
  shopify_refresh_token_expires_at: string | null;
  is_active: boolean | null;
}

class ShopifyCredentialRefreshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShopifyCredentialRefreshError';
  }
}

async function readShopifyIntegrationRow(
  tenantId: string,
): Promise<ShopifyIntegrationRow | null> {
  const serviceClient = createServiceClient();
  const { data, error } = await serviceClient
    .from('tenant_integrations')
    .select(
      'shopify_shop_domain, shopify_admin_token_ciphertext, shopify_token_expires_at, shopify_refresh_token_ciphertext, shopify_refresh_token_expires_at, is_active',
    )
    .eq('tenant_id', tenantId)
    .eq('provider', 'shopify')
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data;
}

async function refreshStoredShopifyToken(
  tenantId: string,
  row: ShopifyIntegrationRow,
): Promise<{ shopDomain: string; adminToken: string }> {
  const shopDomain = row.shopify_shop_domain;
  const refreshTokenCiphertext = row.shopify_refresh_token_ciphertext;

  if (!shopDomain || !refreshTokenCiphertext) {
    throw new ShopifyCredentialRefreshError(
      'Shopify access token expired. Reconnect Shopify in Settings → Integrations.',
    );
  }

  const refreshToken = decryptTenantSecret(refreshTokenCiphertext);
  if (!refreshToken) {
    throw new ShopifyCredentialRefreshError(
      'Stored Shopify refresh token could not be decrypted. Reconnect Shopify in Settings → Integrations.',
    );
  }

  const refreshTokenExpiresAt = row.shopify_refresh_token_expires_at;
  if (
    refreshTokenExpiresAt
    && Date.parse(refreshTokenExpiresAt) <= Date.now()
  ) {
    throw new ShopifyCredentialRefreshError(
      'Shopify refresh token expired. Reconnect Shopify in Settings → Integrations.',
    );
  }

  let tokens;
  try {
    tokens = await refreshShopifyAccessToken(shopDomain, refreshToken);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Shopify token refresh failed.';
    throw new ShopifyCredentialRefreshError(
      `${message} Reconnect Shopify in Settings → Integrations.`,
    );
  }

  await saveShopifyOAuthTokens({
    tenantId,
    shopDomain,
    tokens,
  });

  return { shopDomain, adminToken: tokens.accessToken };
}

export async function loadShopifyCredentials(
  tenantId: string,
): Promise<{ shopDomain: string; adminToken: string } | null> {
  const currentTenantId = await requireCurrentTenantId();
  if (currentTenantId !== tenantId) {
    return null;
  }

  const row = await readShopifyIntegrationRow(tenantId);
  if (!row?.shopify_shop_domain || !row.shopify_admin_token_ciphertext) {
    return null;
  }

  const shopDomain = row.shopify_shop_domain;
  let adminToken = decryptTenantSecret(row.shopify_admin_token_ciphertext);
  if (!adminToken) {
    return null;
  }

  if (shopifyAccessTokenNeedsRefresh(row.shopify_token_expires_at)) {
    try {
      return await refreshStoredShopifyToken(tenantId, row);
    } catch (error) {
      if (error instanceof ShopifyCredentialRefreshError) {
        throw error;
      }

      throw new ShopifyCredentialRefreshError(
        'Shopify token refresh failed. Reconnect Shopify in Settings → Integrations.',
      );
    }
  }

  return { shopDomain, adminToken };
}

export async function getShopifyConnectionStatus(
  tenantId: string,
): Promise<ShopifyConnectionStatus> {
  const row = await readShopifyIntegrationRow(tenantId);

  return {
    connected: Boolean(row?.shopify_shop_domain),
    shopDomain: row?.shopify_shop_domain ?? null,
    tokenExpiresAt: row?.shopify_token_expires_at ?? null,
    usesOAuth: Boolean(row?.shopify_refresh_token_ciphertext),
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

    await assertShopifyReadProductsAccess({ shopDomain, adminToken });
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof ShopifyAccessScopeError
          ? error.message
          : 'Shopify rejected this shop domain or Admin token.',
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
      shopify_token_expires_at: null,
      shopify_refresh_token_ciphertext: null,
      shopify_refresh_token_expires_at: null,
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

export async function disconnectMerchantShopify(): Promise<DisconnectShopifyResult> {
  try {
    await requireCurrentTenantId();
  } catch {
    return {
      success: false,
      message: 'Sign in with an active merchant account.',
    };
  }

  const tenantId = await requireCurrentTenantId();
  const serviceClient = createServiceClient();
  const { error } = await serviceClient
    .from('tenant_integrations')
    .update({
      is_active: false,
      shopify_shop_domain: null,
      shopify_admin_token_ciphertext: null,
      shopify_token_expires_at: null,
      shopify_refresh_token_ciphertext: null,
      shopify_refresh_token_expires_at: null,
    })
    .eq('tenant_id', tenantId)
    .eq('provider', 'shopify');

  if (error) {
    return {
      success: false,
      message: 'Unable to disconnect Shopify.',
    };
  }

  return {
    success: true,
    message: 'Shopify disconnected.',
  };
}
