import { storeTenantBiometricWebps } from '@/lib/server/biometric-upload';
import { consumeRateLimit } from '@/lib/server/durable-rate-limit';
import { RATE_LIMITS, RATE_LIMIT_WINDOW_MS } from '@/lib/server/rate-limit';
import { resolveRequestTenantId } from '@/lib/server/request-tenant';

export const runtime = 'nodejs';
export const maxDuration = 60;

async function readWebpPart(form: FormData, field: 'front' | 'side'): Promise<Uint8Array | null> {
  const value = form.get(field);
  if (!(value instanceof Blob) || value.size <= 0) {
    return null;
  }

  return new Uint8Array(await value.arrayBuffer());
}

export async function POST(request: Request): Promise<Response> {
  let tenantId: string;

  try {
    tenantId = await resolveRequestTenantId(request);
  } catch {
    return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const rateLimit = await consumeRateLimit(
    `upload-url:${tenantId}`,
    RATE_LIMITS.uploadUrl,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!rateLimit.allowed) {
    return Response.json({ code: 'RATE_LIMIT_EXCEEDED' }, { status: 429 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  }

  const [frontBytes, sideBytes] = await Promise.all([
    readWebpPart(form, 'front'),
    readWebpPart(form, 'side'),
  ]);

  if (!frontBytes || !sideBytes) {
    return Response.json(
      {
        code: 'INVALID_WEBP',
        message: 'Front and side captures must be headless WebP photos.',
      },
      { status: 400 },
    );
  }

  try {
    const stored = await storeTenantBiometricWebps(tenantId, frontBytes, sideBytes);
    return Response.json({
      job_id: stored.jobId,
      front: { file_path: stored.frontPath },
      side: { file_path: stored.sidePath },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'STORAGE_UPLOAD_FAILED';
    if (code === 'INVALID_WEBP') {
      return Response.json(
        {
          code,
          message: 'Front and side captures must be headless WebP photos.',
        },
        { status: 400 },
      );
    }

    return Response.json(
      {
        code: 'STORAGE_UPLOAD_FAILED',
        message: 'Unable to store the biometric photos.',
      },
      { status: 502 },
    );
  }
}
