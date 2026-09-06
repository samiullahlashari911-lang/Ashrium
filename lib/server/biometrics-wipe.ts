import { createServiceClient } from '@/lib/supabase/service';

const UUID_PATTERN =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const BIOMETRIC_PATH_PATTERN = new RegExp(
  `^${UUID_PATTERN}/${UUID_PATTERN}/(front|side)\\.webp$`,
  'i',
);

export type BiometricCaptureView = 'front' | 'side';

export interface BiometricJobImagePath {
  tenantId: string;
  jobId: string;
  view: BiometricCaptureView;
}

export function isBiometricAssetPath(filePath: string): boolean {
  return BIOMETRIC_PATH_PATTERN.test(filePath);
}

export function parseBiometricJobImagePath(filePath: string): BiometricJobImagePath | null {
  if (!isBiometricAssetPath(filePath)) {
    return null;
  }

  const [tenantId, jobId, fileName] = filePath.split('/');
  const view = fileName === 'side.webp' ? 'side' : 'front';

  return { tenantId, jobId, view };
}

export async function purgeBiometricAsset(filePath: string): Promise<boolean> {
  if (!isBiometricAssetPath(filePath)) {
    return false;
  }

  const serviceClient = createServiceClient();
  const { error } = await serviceClient.storage.from('biometrics').remove([filePath]);

  return !error;
}

export async function purgeBiometricJobImages(
  frontImagePath: string | null,
  sideImagePath: string | null,
): Promise<boolean> {
  const paths = [frontImagePath, sideImagePath].filter(
    (path): path is string => typeof path === 'string' && path.length > 0,
  );

  if (paths.length === 0) {
    return true;
  }

  const results = await Promise.all(paths.map((path) => purgeBiometricAsset(path)));
  return results.every(Boolean);
}
