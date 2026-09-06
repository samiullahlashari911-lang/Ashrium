import { consumeRateLimit } from '@/lib/server/durable-rate-limit';
import { RATE_LIMITS, RATE_LIMIT_WINDOW_MS } from '@/lib/server/rate-limit';
import { normalizeOrigin, readClientIp } from '@/lib/server/request-origin';
import { createWidgetEmbedToken } from '@/lib/server/widget-embed';
import { createServiceClient } from '@/lib/supabase/service';

function jsonWithCors(
  body: Record<string, string>,
  status: number,
  origin?: string,
  extraHeaders?: Record<string, string>,
): Response {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Origin',
    ...extraHeaders,
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
    return jsonWithCors({ code: 'UNAUTHORIZED_DOMAIN' }, 403);
  }

  const serviceClient = createServiceClient();
  const { data: tenant, error } = await serviceClient
    .from('tenants')
    .select('id')
    .eq('status', 'active')
    .contains('allowed_domains', [origin])
    .maybeSingle();

  if (error || !tenant) {
    return jsonWithCors({ code: 'UNAUTHORIZED_DOMAIN' }, 403);
  }

  const clientIp = readClientIp(request);
  const [tenantLimit, ipLimit] = await Promise.all([
    consumeRateLimit(
      `widget-token:${tenant.id}:${origin}`,
      RATE_LIMITS.widgetToken,
      RATE_LIMIT_WINDOW_MS,
    ),
    consumeRateLimit(
      `widget-token-ip:${clientIp ?? 'unknown'}`,
      RATE_LIMITS.widgetTokenIp,
      RATE_LIMIT_WINDOW_MS,
    ),
  ]);

  if (!tenantLimit.allowed || !ipLimit.allowed) {
    await serviceClient.from('audit_logs').insert({
      tenant_id: tenant.id,
      event_type: 'RATE_LIMIT_EXCEEDED',
      ip_address: clientIp,
      user_agent: request.headers.get('user-agent'),
      payload: { origin, route: 'widget-token' },
    });

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((Math.max(tenantLimit.resetAt, ipLimit.resetAt) - Date.now()) / 1000),
    );
    return jsonWithCors(
      { code: 'RATE_LIMIT_EXCEEDED' },
      429,
      origin,
      { 'Retry-After': String(retryAfterSeconds) },
    );
  }

  try {
    return jsonWithCors({ token: createWidgetEmbedToken(tenant.id) }, 200, origin);
  } catch {
    return jsonWithCors({ code: 'TOKEN_MINT_FAILED' }, 500, origin);
  }
}
