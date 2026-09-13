import { reconcileShopperGpu } from '@/lib/server/abort-shopper-gpu';
import { authorizeCronRequest } from '@/lib/server/cron-secret';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handleGpuGuard(request: Request): Promise<Response> {
  const denied = authorizeCronRequest(request);
  if (denied) {
    return denied;
  }

  try {
    const result = await reconcileShopperGpu();
    return Response.json(
      { ok: true, ...result },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GPU guard failed.';
    return Response.json(
      { ok: false, code: 'GPU_GUARD_FAILED', message },
      {
        status: 500,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  return handleGpuGuard(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleGpuGuard(request);
}
