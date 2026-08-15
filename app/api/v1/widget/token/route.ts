import { checkRateLimit } from '@/lib/server/rate-limit';
import { createWidgetEmbedToken } from '@/lib/server/widget-embed';
import { createServiceClient } from '@/lib/supabase/service';

const TOKEN_RATE_LIMIT = 30;
const TOKEN_RATE_LIMIT_WINDOW_MS = 60 * 1000;

function normalizeOrigin(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    const origin = new URL(value).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

function jsonWithCors(
  body: Record<string, string>,
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
    return jsonWithCors({ code: 'UNAUTHORIZED_DOMAIN' }, 403);
  }

  const serviceClient = createServiceClient();
  const { data: tenant, error } = await serviceClient
    .from('tenants')
    .select('id')
    .contains('allowed_domains', [origin])
    .maybeSingle();

  if (error || !tenant) {
    return jsonWithCors({ code: 'UNAUTHORIZED_DOMAIN' }, 403);
  }

  const rateLimit = checkRateLimit(
    `widget-token:${tenant.id}:${origin}`,
    TOKEN_RATE_LIMIT,
    TOKEN_RATE_LIMIT_WINDOW_MS,
  );
  if (!rateLimit.allowed) {
    return jsonWithCors({ code: 'RATE_LIMIT_EXCEEDED' }, 429, origin);
  }

  try {
    return jsonWithCors({ token: createWidgetEmbedToken(tenant.id) }, 200, origin);
  } catch {
    return jsonWithCors({ code: 'TOKEN_MINT_FAILED' }, 500, origin);
  }
}
