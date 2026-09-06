import { resolveFitDrape } from '@/lib/fit/resolve-drape';
import { consumeRateLimit } from '@/lib/server/durable-rate-limit';
import { parseResolveRequest } from '@/lib/server/fit-request';
import { RATE_LIMITS, RATE_LIMIT_WINDOW_MS } from '@/lib/server/rate-limit';
import { resolveRequestTenantId } from '@/lib/server/request-tenant';
import { createServiceClient } from '@/lib/supabase/service';
import { MHR_TOPOLOGY_VERSION } from '@/types/hmr';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Cache hit → meshopt delta payload.
 * Cache miss → Cog task=drape (Newton XPBD on MHR LOD 3), write delta to
 * garment-simulations, insert simulation_cache. Does not block avatar inference.
 */
export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  }

  const body = parseResolveRequest(payload);
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
    `fit-resolve:${tenantId}`,
    RATE_LIMITS.fitResolve,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!rateLimit.allowed) {
    return Response.json({ code: 'RATE_LIMIT_EXCEEDED' }, { status: 429 });
  }

  try {
    const result = await resolveFitDrape({
      supabase: createServiceClient(),
      tenantId,
      jobId: body.jobId,
      sku: body.sku.trim(),
      allowXpbd: body.allowXpbd,
    });

    return Response.json({
      source: result.source,
      similarity: result.similarity,
      xpbdCompleted: result.xpbdCompleted,
      topologyVersion: result.topologyVersion || MHR_TOPOLOGY_VERSION,
      meanStrain: result.meanStrain,
      payloadBase64: result.payloadBase64,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Drape resolve failed.';
    return Response.json({ code: 'DRAPE_RESOLVE_FAILED', message }, { status: 500 });
  }
}
