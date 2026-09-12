import {
  mergeStorefrontOrigins,
  merchantDomainFromOrigins,
  parseStorefrontOriginList,
} from '@/lib/onboarding';
import { createServiceClient } from '@/lib/supabase/service';

export function shopIdentityStorefrontOrigins(input: {
  myshopifyDomain: string;
  primaryDomainUrl?: string | null;
}): string[] {
  const raw = [`https://${input.myshopifyDomain}`];
  if (input.primaryDomainUrl) {
    raw.push(input.primaryDomainUrl);
  }

  return mergeStorefrontOrigins([], raw);
}

export function configuredEnvStorefrontOrigins(): string[] {
  return parseStorefrontOriginList(
    (process.env.ASHRIUM_ALLOWED_ORIGINS ?? '').split(','),
  ).origins;
}

export function trustedStorefrontOrigins(input: {
  allowedDomains?: readonly string[] | null;
  merchantDomain?: string | null;
  shopifyShopDomain?: string | null;
  extraOrigins?: readonly string[] | null;
}): string[] {
  const shopHost = input.shopifyShopDomain
    ?.replace(/^https?:\/\//i, '')
    .split('/')[0]
    ?.toLowerCase();

  return mergeStorefrontOrigins([], [
    ...(input.allowedDomains ?? []),
    input.merchantDomain ?? '',
    shopHost ? `https://${shopHost}` : '',
    ...(input.extraOrigins ?? []),
  ]);
}

export async function mergeTenantStorefrontOrigins(
  tenantId: string,
  incoming: readonly string[],
): Promise<void> {
  if (incoming.length === 0) {
    return;
  }

  const supabase = createServiceClient();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('allowed_domains')
    .eq('id', tenantId)
    .maybeSingle();

  const merged = mergeStorefrontOrigins(tenant?.allowed_domains ?? [], incoming);
  const { error } = await supabase
    .from('tenants')
    .update({ allowed_domains: merged })
    .eq('id', tenantId);

  if (error) {
    throw new Error('Unable to update the storefront allowlist.');
  }

  const merchantDomain = merchantDomainFromOrigins(merged);
  if (!merchantDomain) {
    return;
  }

  await supabase.from('merchants').update({ domain: merchantDomain }).eq('id', tenantId);
}

export async function findActiveTenantIdForStorefrontOrigin(
  origin: string,
): Promise<string | null> {
  const supabase = createServiceClient();
  const { data: allowlisted } = await supabase
    .from('tenants')
    .select('id')
    .eq('status', 'active')
    .contains('allowed_domains', [origin])
    .limit(1);

  const allowlistedId = allowlisted?.[0]?.id;
  if (allowlistedId) {
    // #region agent log
    fetch('http://127.0.0.1:7718/ingest/5c6f4191-5d6f-487b-adb7-f441fc4ce685',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'06d10c'},body:JSON.stringify({sessionId:'06d10c',runId:'pre-fix',hypothesisId:'H5',location:'lib/server/storefront-allowlist.ts:findActiveTenantIdForStorefrontOrigin',message:'tenant via allowlist',data:{origin,branch:'allowlist'},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return allowlistedId;
  }

  let hostname: string;
  try {
    hostname = new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }

  const { data: integration } = await supabase
    .from('tenant_integrations')
    .select('tenant_id')
    .eq('provider', 'shopify')
    .eq('is_active', true)
    .eq('shopify_shop_domain', hostname)
    .limit(1);

  const integrationTenantId = integration?.[0]?.tenant_id;
  if (integrationTenantId) {
    const { data: tenant } = await supabase
      .from('tenants')
      .select('id')
      .eq('id', integrationTenantId)
      .eq('status', 'active')
      .maybeSingle();
    if (tenant?.id) {
      return tenant.id;
    }
  }

  if (!configuredEnvStorefrontOrigins().includes(origin)) {
    return null;
  }

  const { data: activeTenants } = await supabase
    .from('tenants')
    .select('id')
    .eq('status', 'active')
    .limit(2);

  if (!activeTenants || activeTenants.length !== 1) {
    return null;
  }

  return activeTenants[0]?.id ?? null;
}
