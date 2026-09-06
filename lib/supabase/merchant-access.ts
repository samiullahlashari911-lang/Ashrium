import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

export type MerchantPortalBlockReason = 'unauthenticated' | 'no_tenant' | 'inactive';

export type MerchantPortalAccess =
  | { allowed: true; tenantId: string }
  | { allowed: false; reason: MerchantPortalBlockReason };

export function merchantPortalSignInPath(reason: MerchantPortalBlockReason): string {
  return `/sign-in?error=${reason}`;
}

export function merchantPortalErrorCopy(reason: string | null): string | null {
  switch (reason) {
    case 'unauthenticated':
      return 'Sign in with the work email we invited.';
    case 'no_tenant':
      return 'This email is not an invited Ashrium merchant. Access is contract-only — we provision your workspace.';
    case 'inactive':
      return 'This merchant workspace is suspended. Contact Ashrium if you believe this is a mistake.';
    case 'invite_only':
      return 'Ashrium does not offer self-serve signup. We invite contracted merchants only.';
    default:
      return null;
  }
}

export async function readMerchantPortalAccess(
  supabase: SupabaseClient<Database>,
): Promise<MerchantPortalAccess> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { allowed: false, reason: 'unauthenticated' };
  }

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id, status')
    .eq('owner_user_id', data.user.id)
    .maybeSingle();

  if (tenantError || !tenant) {
    return { allowed: false, reason: 'no_tenant' };
  }

  if (tenant.status !== 'active') {
    return { allowed: false, reason: 'inactive' };
  }

  return { allowed: true, tenantId: tenant.id };
}
