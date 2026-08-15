import { createClient } from '@/lib/supabase/server';

interface TenantMetadata {
  tenant_id?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractTenantId(metadata: unknown): string | null {
  if (!isRecord(metadata)) {
    return null;
  }

  const tenantId = metadata.tenant_id;
  return typeof tenantId === 'string' && tenantId.length > 0 ? tenantId : null;
}

/**
 * Resolves the active tenant_id from Supabase Auth JWT app_metadata.
 * RLS policies on garment_cad_profiles rely on the same claim via get_current_tenant_id().
 */
export async function getCurrentTenantId(): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return null;
  }

  return extractTenantId(data.user.app_metadata as TenantMetadata);
}

export async function requireCurrentTenantId(): Promise<string> {
  const tenantId = await getCurrentTenantId();

  if (!tenantId) {
    throw new Error('Authenticated tenant context is required.');
  }

  return tenantId;
}
