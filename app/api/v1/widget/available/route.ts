import { consumeRateLimit } from '@/lib/server/durable-rate-limit';
import { RATE_LIMITS, RATE_LIMIT_WINDOW_MS } from '@/lib/server/rate-limit';
import { normalizeOrigin, readClientIp } from '@/lib/server/request-origin';
import { findActiveTenantIdForStorefrontOrigin } from '@/lib/server/storefront-allowlist';
import { resolveWidgetGarment } from '@/lib/supabase/garment-profiles';
import { createServiceClient } from '@/lib/supabase/service';

function jsonWithCors(
  body: Record<string, unknown>,
  status: number,
  origin?: string,
): Response {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Origin',
  });
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
  }

  return new Response(JSON.stringify(body), { status, headers });
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const origin = normalizeOrigin(request.headers.get('origin'));
  if (!origin) {
    return jsonWithCors({ available: false, code: 'UNAUTHORIZED_DOMAIN' }, 403);
  }

  const tenantId = await findActiveTenantIdForStorefrontOrigin(origin);
  if (!tenantId) {
    return jsonWithCors({ available: false, code: 'UNAUTHORIZED_DOMAIN' }, 403);
  }

  const serviceClient = createServiceClient();
  const tenant = { id: tenantId };

  const clientIp = readClientIp(request);
  const limit = await consumeRateLimit(
    `widget-available:${tenant.id}:${origin}:${clientIp ?? 'unknown'}`,
    RATE_LIMITS.widgetToken,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!limit.allowed) {
    return jsonWithCors({ available: false, code: 'RATE_LIMIT_EXCEEDED' }, 429, origin);
  }

  let payload: unknown = {};
  try {
    payload = JSON.parse(await request.text()) as unknown;
  } catch {
    payload = {};
  }

  const record = typeof payload === 'object' && payload !== null
    ? (payload as { handle?: unknown; sku?: unknown })
    : {};
  const handle = typeof record.handle === 'string' ? record.handle.trim() : '';
  const sku = typeof record.sku === 'string' ? record.sku.trim() : '';
  if (!handle && !sku) {
    return jsonWithCors({ available: false }, 200, origin);
  }

  const resolved = await resolveWidgetGarment(serviceClient, tenant.id, {
    handle: handle || undefined,
    sku: sku || undefined,
  });

  return jsonWithCors({ available: Boolean(resolved) }, 200, origin);
}
