import { mergeStorefrontOrigins, merchantDomainFromOrigins } from '@/lib/onboarding';
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
