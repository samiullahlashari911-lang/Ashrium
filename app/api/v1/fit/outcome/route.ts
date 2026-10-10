import { consumeRateLimit } from '@/lib/server/durable-rate-limit';
import { parseOutcomeRequest } from '@/lib/server/fit-request';
import { RATE_LIMITS, RATE_LIMIT_WINDOW_MS } from '@/lib/server/rate-limit';
import { resolveRequestTenantId } from '@/lib/server/request-tenant';
import { recordTryOnOutcome } from '@/lib/server/try-on-outcome';

export const runtime = 'nodejs';

/**
 * The shopper's device reports whether a size was actually drawn on their
 * photo. Labels only (SKU, size, drawn yes/no), scoped to the embed token's
 * tenant; it completes the job's try-on outcome log.
 */
export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  }

  const body = parseOutcomeRequest(payload);
  if (!body) {
    return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  }

  let tenantId: string;
  try {
    tenantId = await resolveRequestTenantId(request);
  } catch {
    return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const rateLimit = await consumeRateLimit(
    `fit-outcome:${tenantId}`,
    RATE_LIMITS.fitOutcome,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!rateLimit.allowed) {
    return Response.json({ code: 'RATE_LIMIT_EXCEEDED' }, { status: 429 });
  }

  await recordTryOnOutcome(body.jobId, tenantId, {
    kind: 'shown',
    sku: body.sku,
    size: body.sizeCode,
    shown: body.shown,
  });
  return new Response(null, { status: 204 });
}
