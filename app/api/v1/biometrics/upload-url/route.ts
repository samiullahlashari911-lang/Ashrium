import { randomUUID } from 'node:crypto';

import { consumeRateLimit } from '@/lib/server/durable-rate-limit';
import { configureBiometricsBucketCors } from '@/lib/server/biometrics-cors';
import { RATE_LIMITS, RATE_LIMIT_WINDOW_MS } from '@/lib/server/rate-limit';
import { resolveRequestTenantId } from '@/lib/server/request-tenant';
import { createServiceClient } from '@/lib/supabase/service';

const SIGNED_UPLOAD_EXPIRY_SECONDS = 2 * 60 * 60;

export const runtime = 'nodejs';

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

  void configureBiometricsBucketCors();

  const jobId = randomUUID();
  const frontPath = `${tenantId}/${jobId}/front.webp`;
  const sidePath = `${tenantId}/${jobId}/side.webp`;
  const serviceClient = createServiceClient();

  const [frontUpload, sideUpload] = await Promise.all([
    serviceClient.storage.from('biometrics').createSignedUploadUrl(frontPath, { upsert: true }),
    serviceClient.storage.from('biometrics').createSignedUploadUrl(sidePath, { upsert: true }),
  ]);

  if (frontUpload.error || !frontUpload.data || sideUpload.error || !sideUpload.data) {
    return Response.json({ code: 'UPLOAD_URL_CREATION_FAILED' }, { status: 500 });
  }

  return Response.json({
    job_id: jobId,
    front: {
      upload_url: frontUpload.data.signedUrl,
      file_path: frontPath,
    },
    side: {
      upload_url: sideUpload.data.signedUrl,
      file_path: sidePath,
    },
    expires_in: SIGNED_UPLOAD_EXPIRY_SECONDS,
  });
}
