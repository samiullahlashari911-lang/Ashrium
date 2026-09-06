import { authorizeCronRequest } from '@/lib/server/cron-secret';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handleTtlSweep(request: Request): Promise<Response> {
  const denied = authorizeCronRequest(request);
  if (denied) {
    return denied;
  }

  try {
    const { runPrivacyTtlSweep } = await import('@/lib/server/ttl-sweep');
    const result = await runPrivacyTtlSweep();

    return Response.json(
      { ok: true, ...result },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'TTL sweep failed.';
    return Response.json(
      { ok: false, code: 'TTL_SWEEP_FAILED', message },
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  return handleTtlSweep(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleTtlSweep(request);
}
