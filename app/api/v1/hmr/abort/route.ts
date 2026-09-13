import { abortShopperFitJobById } from '@/lib/server/abort-shopper-gpu';
import { consumeRateLimit } from '@/lib/server/durable-rate-limit';
import { isFitJobId } from '@/lib/server/fit-request';
import { RATE_LIMITS, RATE_LIMIT_WINDOW_MS } from '@/lib/server/rate-limit';
import { resolveRequestTenantId } from '@/lib/server/request-tenant';
import {
  deleteShopperGpuSession,
  sleepGpuIfNoActiveFitJobs,
} from '@/lib/server/session-gpu';

export const runtime = 'nodejs';
export const maxDuration = 30;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseAbortRequest(value: unknown): {
  jobId?: string;
  gpuSessionKey?: string;
} | null {
  if (!isRecord(value)) {
    return null;
  }

  const jobId = isFitJobId(value.jobId) ? value.jobId : undefined;
  const rawKey = typeof value.gpuSessionKey === 'string' ? value.gpuSessionKey.trim() : '';
  const gpuSessionKey = rawKey.length >= 8 && rawKey.length <= 80 ? rawKey : undefined;
  if (!jobId && !gpuSessionKey) {
    return null;
  }

  return { jobId, gpuSessionKey };
}

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  }

  const body = parseAbortRequest(payload);
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
    `hmr-abort:${tenantId}`,
    RATE_LIMITS.hmrAbort,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!rateLimit.allowed) {
    return Response.json({ code: 'RATE_LIMIT_EXCEEDED' }, { status: 429 });
  }

  if (body.gpuSessionKey) {
    await deleteShopperGpuSession(tenantId, body.gpuSessionKey);
  }

  if (body.jobId) {
    await abortShopperFitJobById(body.jobId, tenantId);
  } else {
    await sleepGpuIfNoActiveFitJobs();
  }

  return Response.json({ ok: true, status: 'stopped' });
}
