import { verifyWidgetEmbedToken } from '@/lib/server/widget-embed';
import { createServiceClient } from '@/lib/supabase/service';
import { requireCurrentTenantId } from '@/lib/supabase/tenant';

function readBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token.trim() || null;
}

/**
 * Resolves tenant_id from a widget embed token or the merchant session.
 * Embed tokens mint upload URLs and dispatch HMR; they are not merchant JWTs.
 */
async function assertTenantIsActive(tenantId: string): Promise<void> {
  const serviceClient = createServiceClient();
  const { data: tenant, error } = await serviceClient
    .from('tenants')
    .select('status')
    .eq('id', tenantId)
    .maybeSingle();

  if (error || !tenant || tenant.status !== 'active') {
    throw new Error('Active contracted tenant context is required.');
  }
}

export async function resolveRequestTenantId(request: Request): Promise<string> {
  const bearer = readBearerToken(request);
  if (bearer) {
    const claims = verifyWidgetEmbedToken(bearer);
    if (claims) {
      await assertTenantIsActive(claims.tenantId);
      return claims.tenantId;
    }
  }

  const tenantId = await requireCurrentTenantId();
  await assertTenantIsActive(tenantId);
  return tenantId;
}
