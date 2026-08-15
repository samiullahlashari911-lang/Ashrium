import { runHmrEstimation } from '@/lib/ml/replicate';
import { TenantQuotaExceededError, verifyAndRecordTenantUsage } from '@/lib/server/usage-meter';
import { verifyWidgetEmbedToken } from '@/lib/server/widget-embed';

interface ReconstructionRequest {
  imageUrl: string;
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return null;
  }

  const token = authorization.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

function isReconstructionRequest(value: unknown): value is ReconstructionRequest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const request = value as Record<string, unknown>;
  return typeof request.imageUrl === 'string' && request.imageUrl.length > 0;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<Response> {
  const token = getBearerToken(request);
  const claims = token ? verifyWidgetEmbedToken(token) : null;

  if (!claims) {
    return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  }

  if (!isReconstructionRequest(payload) || !isHttpsUrl(payload.imageUrl)) {
    return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  }

  try {
    await verifyAndRecordTenantUsage(claims.tenantId);
    const reconstruction = await runHmrEstimation({ imageUrl: payload.imageUrl });

    return Response.json({ reconstruction });
  } catch (error) {
    if (error instanceof TenantQuotaExceededError) {
      return Response.json({ code: 'QUOTA_EXCEEDED' }, { status: 402 });
    }

    return Response.json({ code: 'RECONSTRUCTION_UNAVAILABLE' }, { status: 503 });
  }
}
