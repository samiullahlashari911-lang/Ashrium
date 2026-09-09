import { after } from 'next/server';

import { watchWarmGpuIdleTimeout } from '@/lib/server/abort-shopper-gpu';
import { consumeRateLimit } from '@/lib/server/durable-rate-limit';
import { RATE_LIMITS, RATE_LIMIT_WINDOW_MS } from '@/lib/server/rate-limit';
import { resolveRequestTenantId } from '@/lib/server/request-tenant';
import { warmGpuForShopperSubmit } from '@/lib/server/session-gpu';

export const runtime = 'nodejs';
export const maxDuration = 190;

export async function POST(request: Request): Promise<Response> {
  let tenantId: string;
  try {
    tenantId = await resolveRequestTenantId(request);
  } catch {
    return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const rateLimit = await consumeRateLimit(
    `hmr-warmup:${tenantId}`,
    RATE_LIMITS.hmrWarmup,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!rateLimit.allowed) {
    return Response.json({ code: 'RATE_LIMIT_EXCEEDED' }, { status: 429 });
  }

  try {
    await warmGpuForShopperSubmit();
  } catch {
    return Response.json({ code: 'SESSION_GPU_FAILED' }, { status: 502 });
  }

  after(() => {
    void watchWarmGpuIdleTimeout();
  });

  return Response.json({ ok: true, status: 'warming' }, { status: 202 });
}
