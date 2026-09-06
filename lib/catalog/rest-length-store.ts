import type { RestLengthMesh } from '@/types/garment';
import { createServiceClient } from '@/lib/supabase/service';

export const GARMENT_CAD_BUCKET = 'garment-cad';

export function sanitizeSizeCodeForPath(sizeCode: string): string {
  const compact = sizeCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return compact.slice(0, 16) || 'OS';
}

export function restLengthObjectPath(
  tenantId: string,
  garmentId: string,
  sizeCode: string,
): string {
  return `${tenantId}/${garmentId}/${sanitizeSizeCodeForPath(sizeCode)}.json`;
}

export async function writeRestLengthMesh(
  tenantId: string,
  garmentId: string,
  mesh: RestLengthMesh,
): Promise<string> {
  const path = restLengthObjectPath(tenantId, garmentId, mesh.sizeCode);
  const body = JSON.stringify(mesh);
  const serviceClient = createServiceClient();
  const { error } = await serviceClient.storage.from(GARMENT_CAD_BUCKET).upload(path, body, {
    upsert: true,
    contentType: 'application/json',
    cacheControl: 'no-store',
  });

  if (error) {
    throw new Error(error.message);
  }

  return path;
}
