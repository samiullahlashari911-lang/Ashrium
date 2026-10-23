import { after } from 'next/server';

import { readModalSessionGpu, setModalSessionGpu } from '@/lib/ml/gpu';
import { reconcileShopperGpu } from '@/lib/server/abort-shopper-gpu';
import { authorizeCronRequest } from '@/lib/server/cron-secret';
import { authorizeGpuScaleRequest } from '@/lib/server/gpu-control-auth';
import {
  closeDemoGpuWindow,
  demoGpuWindowEndsAt,
  openDemoGpuWindow,
} from '@/lib/server/session-gpu';
import { requireCurrentTenantId } from '@/lib/supabase/tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The demo window's watcher runs in after() for up to DEMO_WATCH_SLICE_MS.
export const maxDuration = 300;

const DEMO_DEFAULT_MINUTES = 6;
/** One watcher call stays under maxDuration, then hands over to a fresh call. */
const DEMO_WATCH_SLICE_MS = 260_000;
const DEMO_WATCH_POLL_MS = 10_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isConfigurationError(message: string): boolean {
  return (
    message.includes('MODAL_GPU_URL')
    || message.includes('ASHRIUM_GPU_HMAC')
  );
}

type KeepAliveAction = 'warm' | 'sleep' | 'status' | 'demo' | 'demo-watch';

function parseSessionAction(value: unknown): KeepAliveAction {
  if (!isRecord(value)) {
    return 'warm';
  }

  const action = value.action;
  if (
    action === 'sleep'
    || action === 'status'
    || action === 'warm'
    || action === 'demo'
    || action === 'demo-watch'
  ) {
    return action;
  }

  return 'warm';
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Puts the GPU back to sleep when the demo window ends, even if the operator's
 * laptop is gone: polls the lease, and past one function's budget hands over
 * to a fresh call of this route (same operator bearer).
 */
async function watchDemoGpuWindow(request: Request): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < DEMO_WATCH_SLICE_MS) {
    const endsAt = await demoGpuWindowEndsAt();
    if (endsAt === null) {
      await reconcileShopperGpu();
      return;
    }
    await sleepMs(Math.min(DEMO_WATCH_POLL_MS, Math.max(1_000, endsAt - Date.now())));
  }

  await fetch(new URL('/api/v1/hmr/keepalive', request.url), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: request.headers.get('authorization') ?? '',
    },
    body: JSON.stringify({ action: 'demo-watch' }),
  });
}

async function handleDemoWindow(request: Request, payload: unknown): Promise<Response> {
  const denied = authorizeGpuScaleRequest(request);
  if (denied) {
    return denied;
  }

  const tenantId = isRecord(payload) && typeof payload.tenant_id === 'string' ? payload.tenant_id : '';
  if (!UUID_PATTERN.test(tenantId)) {
    return Response.json({ ok: false, code: 'INVALID_REQUEST', message: 'tenant_id is required.' }, { status: 400 });
  }
  const minutes = isRecord(payload) && typeof payload.minutes === 'number'
    ? payload.minutes
    : DEMO_DEFAULT_MINUTES;

  try {
    const window = await openDemoGpuWindow(tenantId, minutes);
    after(() => watchDemoGpuWindow(request));
    return Response.json(
      { ok: true, action: 'demo', ends_at: window.expiresAt, min_containers_updated: window.minInstancesUpdated },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Demo GPU window failed.';
    return Response.json({ ok: false, code: 'SESSION_GPU_FAILED', message }, { status: 502 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function authorizeKeepAlive(request: Request): Promise<Response | null> {
  const cronDenied = authorizeCronRequest(request);
  if (!cronDenied) {
    return null;
  }

  if (!request.headers.get('cookie')) {
    return cronDenied;
  }

  try {
    await requireCurrentTenantId();
    return null;
  } catch {
    return cronDenied;
  }
}

function sessionGpuJson(result: Awaited<ReturnType<typeof readModalSessionGpu>>): Response {
  return Response.json(
    {
      ok: true,
      action: result.action,
      hardware: {
        sku: result.hardware.sku,
        pin_mode: result.hardware.pinMode,
        deployment: result.hardware.deployment,
      },
      deployment: {
        name: result.hardware.deployment,
        hardware: result.hardware.sku,
        min_instances: result.minContainers,
        min_containers: result.minContainers,
        max_instances: result.maxContainers,
        max_containers: result.maxContainers,
        min_instances_updated: result.minContainersUpdated,
        min_containers_updated: result.minContainersUpdated,
      },
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}

async function handleKeepAlive(request: Request, action: 'warm' | 'sleep' | 'status'): Promise<Response> {
  const denied = action === 'status'
    ? await authorizeKeepAlive(request)
    : authorizeGpuScaleRequest(request);
  if (denied) {
    return denied;
  }

  try {
    if (action === 'sleep') {
      await closeDemoGpuWindow();
    }
    const result = action === 'status'
      ? await readModalSessionGpu()
      : await setModalSessionGpu(action);
    return sessionGpuJson(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Session GPU request failed.';
    const configurationError = isConfigurationError(message);

    return Response.json(
      {
        ok: false,
        code: configurationError ? 'GPU_UNCONFIGURED' : 'SESSION_GPU_FAILED',
        message,
      },
      {
        status: configurationError ? 503 : 502,
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  return handleKeepAlive(request, 'status');
}

export async function POST(request: Request): Promise<Response> {
  let action: KeepAliveAction = 'warm';
  let payload: unknown = null;
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      payload = await request.json();
      action = parseSessionAction(payload);
    } catch {
      action = 'warm';
    }
  }

  if (action === 'demo') {
    return handleDemoWindow(request, payload);
  }
  if (action === 'demo-watch') {
    const denied = authorizeGpuScaleRequest(request);
    if (denied) {
      return denied;
    }
    after(() => watchDemoGpuWindow(request));
    return Response.json({ ok: true, action: 'demo-watch' }, { status: 202 });
  }

  return handleKeepAlive(request, action);
}
