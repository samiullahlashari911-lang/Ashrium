import { randomUUID } from 'node:crypto';

import { createServiceClient } from '@/lib/supabase/service';

/** Matches the biometrics bucket `file_size_limit`. */
export const BIOMETRIC_WEBP_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Replicate downloads `front_image` / `side_image` when the A100 worker
 * starts, not when the prediction is queued. 60s signed URLs expire during
 * a cold boot. Align with the 15-minute biometric TTL.
 */
export const BIOMETRIC_SIGNED_READ_SECONDS = 15 * 60;

const WEBP_RIFF = [0x52, 0x49, 0x46, 0x46] as const;
const WEBP_FOURCC = [0x57, 0x45, 0x42, 0x50] as const;

export function isWebpBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12 || bytes.byteLength > BIOMETRIC_WEBP_MAX_BYTES) {
    return false;
  }

  for (let index = 0; index < WEBP_RIFF.length; index += 1) {
    if (bytes[index] !== WEBP_RIFF[index]) {
      return false;
    }
  }

  for (let index = 0; index < WEBP_FOURCC.length; index += 1) {
    if (bytes[8 + index] !== WEBP_FOURCC[index]) {
      return false;
    }
  }

  return true;
}

export async function storeTenantBiometricWebps(
  tenantId: string,
  frontBytes: Uint8Array,
  sideBytes: Uint8Array,
): Promise<{ jobId: string; frontPath: string; sidePath: string }> {
  if (!isWebpBytes(frontBytes) || !isWebpBytes(sideBytes)) {
    throw new Error('INVALID_WEBP');
  }

  const jobId = randomUUID();
  const frontPath = `${tenantId}/${jobId}/front.webp`;
  const sidePath = `${tenantId}/${jobId}/side.webp`;
  const serviceClient = createServiceClient();

  const [frontUpload, sideUpload] = await Promise.all([
    serviceClient.storage.from('biometrics').upload(frontPath, frontBytes, {
      contentType: 'image/webp',
      upsert: true,
    }),
    serviceClient.storage.from('biometrics').upload(sidePath, sideBytes, {
      contentType: 'image/webp',
      upsert: true,
    }),
  ]);

  if (frontUpload.error || sideUpload.error) {
    await serviceClient.storage.from('biometrics').remove([frontPath, sidePath]);
    throw new Error('STORAGE_UPLOAD_FAILED');
  }

  return { jobId, frontPath, sidePath };
}
