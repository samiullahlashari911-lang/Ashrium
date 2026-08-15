import { createServiceClient } from '@/lib/supabase/service';

const BIOMETRIC_PATH_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/i;

export function isBiometricAssetPath(filePath: string): boolean {
  return BIOMETRIC_PATH_PATTERN.test(filePath);
}

export async function purgeBiometricAsset(filePath: string): Promise<boolean> {
  if (!isBiometricAssetPath(filePath)) {
    return false;
  }

  const serviceClient = createServiceClient();
  const { error } = await serviceClient.storage.from('biometrics').remove([filePath]);

  return !error;
}
