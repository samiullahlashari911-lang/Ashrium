import { createClient } from '@/lib/supabase/server';
import { readMerchantPortalAccess } from '@/lib/supabase/merchant-access';

/**
 * Resolves the active contracted tenant for the signed-in merchant.
 * JWT app_metadata.tenant_id remains the RLS claim; this also requires tenants.status = active.
 */
export async function getCurrentTenantId(): Promise<string | null> {
  const supabase = await createClient();
  const access = await readMerchantPortalAccess(supabase);
  return access.allowed ? access.tenantId : null;
}

export async function requireCurrentTenantId(): Promise<string> {
  const tenantId = await getCurrentTenantId();

  if (!tenantId) {
    throw new Error('Authenticated tenant context is required.');
  }

  return tenantId;
}
