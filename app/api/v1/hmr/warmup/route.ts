import { after } from 'next/server';

import { watchWarmGpuIdleTimeout } from '@/lib/server/abort-shopper-gpu';
import { consumeRateLimit } from '@/lib/server/durable-rate-limit';
import { FITTING_ROOM_AT_CAPACITY_MESSAGE } from '@/lib/ml/session-gpu';
import { RATE_LIMITS, RATE_LIMIT_WINDOW_MS } from '@/lib/server/rate-limit';
import { resolveRequestTenantId } from '@/lib/server/request-tenant';
import {
  claimShopperGpuSession,
  FittingRoomAtCapacityError,
} from '@/lib/server/session-gpu';

export const runtime = 'nodejs';
export const maxDuration = 30;

function readSessionKey(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const key = Reflect.get(payload, 'sessionKey');
  return typeof key === 'string' && key.trim().length >= 8 ? key.trim() : null;
}

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

  let payload: unknown = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const sessionKey = readSessionKey(payload);
  if (!sessionKey) {
    return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  }

  try {
    await claimShopperGpuSession(tenantId, sessionKey);
  } catch (error) {
    if (error instanceof FittingRoomAtCapacityError) {
      return Response.json(
        { code: 'FITTING_ROOM_AT_CAPACITY', message: FITTING_ROOM_AT_CAPACITY_MESSAGE },
        { status: 409 },
      );
    }

    return Response.json({ code: 'SESSION_GPU_FAILED' }, { status: 502 });
  }

  after(() => {
    void watchWarmGpuIdleTimeout();
  });

  return Response.json({ ok: true, status: 'warming' }, { status: 202 });
}
