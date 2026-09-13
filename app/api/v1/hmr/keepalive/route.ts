import { readModalSessionGpu, setModalSessionGpu } from '@/lib/ml/gpu';
import { authorizeCronRequest } from '@/lib/server/cron-secret';
import { authorizeGpuScaleRequest } from '@/lib/server/gpu-control-auth';
import { requireCurrentTenantId } from '@/lib/supabase/tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isConfigurationError(message: string): boolean {
  return (
    message.includes('MODAL_GPU_URL')
    || message.includes('ASHRIUM_GPU_HMAC')
  );
}

function parseSessionAction(value: unknown): 'warm' | 'sleep' | 'status' {
  if (!isRecord(value)) {
    return 'warm';
  }

  const action = value.action;
  if (action === 'sleep' || action === 'status' || action === 'warm') {
    return action;
  }

  return 'warm';
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
  let action: 'warm' | 'sleep' | 'status' = 'warm';
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      action = parseSessionAction(await request.json());
    } catch {
      action = 'warm';
    }
  }

  return handleKeepAlive(request, action);
}
