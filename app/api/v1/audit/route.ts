import { checkRateLimit } from '@/lib/server/rate-limit';
import { createServiceClient } from '@/lib/supabase/service';
import { requireCurrentTenantId } from '@/lib/supabase/tenant';
import type { AuditLogEventType, Json } from '@/types/database';

interface AuditEventRequest {
  event_type: AuditLogEventType;
  payload: Json;
}

const AUDIT_RATE_LIMIT = 60;
const AUDIT_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_PAYLOAD_LENGTH = 8 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isJson(value: unknown): value is Json {
  if (
    value === null
    || typeof value === 'boolean'
    || typeof value === 'number'
    || typeof value === 'string'
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJson);
  }

  return isRecord(value) && Object.values(value).every(isJson);
}

function isAuditEventRequest(value: unknown): value is AuditEventRequest {
  return isRecord(value)
    && (value.event_type === 'UNAUTHORIZED_DOMAIN_ACCESS' || value.event_type === 'RATE_LIMIT_EXCEEDED')
    && isJson(value.payload);
}

function getClientIpAddress(headers: Headers): string | null {
  const forwardedFor = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const candidate = forwardedFor ?? headers.get('x-real-ip')?.trim();

  return candidate && /^[0-9a-f:.]{1,45}$/i.test(candidate) ? candidate : null;
}

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  let tenantId: string;

  try {
    tenantId = await requireCurrentTenantId();
  } catch {
    return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const ipAddress = getClientIpAddress(request.headers);
  const rateLimit = checkRateLimit(
    `audit:${tenantId}:${ipAddress ?? 'unknown'}`,
    AUDIT_RATE_LIMIT,
    AUDIT_RATE_LIMIT_WINDOW_MS,
  );
  const serviceClient = createServiceClient();

  if (!rateLimit.allowed) {
    await serviceClient.from('audit_logs').insert({
      tenant_id: tenantId,
      event_type: 'RATE_LIMIT_EXCEEDED',
      ip_address: ipAddress,
      user_agent: request.headers.get('user-agent')?.slice(0, 512) ?? null,
      payload: { route: '/api/v1/audit' },
    });

    return Response.json(
      { code: 'RATE_LIMIT_EXCEEDED', reset_at: rateLimit.resetAt },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.max(Math.ceil((rateLimit.resetAt - Date.now()) / 1000), 1)),
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  }

  if (!isAuditEventRequest(body) || JSON.stringify(body.payload).length > MAX_PAYLOAD_LENGTH) {
    return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  }

  const { error } = await serviceClient.from('audit_logs').insert({
    tenant_id: tenantId,
    event_type: body.event_type,
    ip_address: ipAddress,
    user_agent: request.headers.get('user-agent')?.slice(0, 512) ?? null,
    payload: body.payload,
  });

  if (error) {
    return Response.json({ code: 'AUDIT_LOG_WRITE_FAILED' }, { status: 500 });
  }

  return Response.json({ recorded: true }, { status: 201 });
}
