import { setReplicateSessionGpu, readReplicateSessionGpu } from '@/lib/ml/replicate';
import { authorizeCronRequest } from '@/lib/server/cron-secret';
import { authorizeGpuScaleRequest } from '@/lib/server/gpu-control-auth';
import { requireCurrentTenantId } from '@/lib/supabase/tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isConfigurationError(message: string): boolean {
  return (
    message.includes('REPLICATE_HMR_MODEL_VERSION')
    || message.includes('REPLICATE_API_TOKEN')
    || message.includes('REPLICATE_HARDWARE')
    || message.includes('REPLICATE_DEPLOYMENT')
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

function sessionGpuJson(result: Awaited<ReturnType<typeof readReplicateSessionGpu>>): Response {
  return Response.json(
    {
      ok: true,
      action: result.action,
      model: {
        configured: result.confirmation.configured,
        version_id: result.confirmation.versionId,
        owner: result.confirmation.owner,
        name: result.confirmation.name,
        cog_version: result.confirmation.cogVersion,
        matches_deployment: result.versionMatchesDeployment,
      },
      hardware: {
        sku: result.hardware.sku,
        pin_mode: result.hardware.pinMode,
        deployment: result.hardware.deployment,
        deployment_hardware: result.deployment.hardware,
        deployment_hardware_updated: result.hardwareUpdated,
      },
      deployment: {
        owner: result.deployment.owner,
        name: result.deployment.name,
        hardware: result.deployment.hardware,
        min_instances: result.deployment.minInstances,
        max_instances: result.deployment.maxInstances,
        model: result.deployment.model,
        version: result.deployment.version,
        min_instances_updated: result.minInstancesUpdated,
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
      ? await readReplicateSessionGpu()
      : await setReplicateSessionGpu(action);
    return sessionGpuJson(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Session GPU request failed.';
    const configurationError = isConfigurationError(message);

    return Response.json(
      {
        ok: false,
        code: configurationError ? 'REPLICATE_UNCONFIGURED' : 'SESSION_GPU_FAILED',
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
