import { randomUUID } from 'node:crypto';

import { createServiceClient } from '@/lib/supabase/service';
import { requireCurrentTenantId } from '@/lib/supabase/tenant';

const SIGNED_UPLOAD_EXPIRY_SECONDS = 2 * 60 * 60;

export const runtime = 'nodejs';

export async function POST(): Promise<Response> {
  let tenantId: string;

  try {
    tenantId = await requireCurrentTenantId();
  } catch {
    return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const filePath = `${tenantId}/${randomUUID()}.jpg`;
  const serviceClient = createServiceClient();
  const { data, error } = await serviceClient.storage
    .from('biometrics')
    .createSignedUploadUrl(filePath);

  if (error || !data) {
    return Response.json({ code: 'UPLOAD_URL_CREATION_FAILED' }, { status: 500 });
  }

  return Response.json({
    upload_url: data.signedUrl,
    file_path: filePath,
    expires_in: SIGNED_UPLOAD_EXPIRY_SECONDS,
  });
}
