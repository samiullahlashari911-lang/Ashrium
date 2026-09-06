import {
  isBiometricAssetPath,
  parseBiometricJobImagePath,
} from '@/lib/server/biometrics-wipe';
import type { CaptureSex } from '@/types/hmr';

export interface AnnyFitDispatchRequest {
  frontImagePath: string;
  sideImagePath: string;
  heightCm: number;
  sex: CaptureSex;
  weightKg?: number;
}

const CAPTURE_SEXES: ReadonlySet<CaptureSex> = new Set(['female', 'male', 'unspecified']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCaptureSex(value: unknown): value is CaptureSex {
  return typeof value === 'string' && CAPTURE_SEXES.has(value as CaptureSex);
}

export function parseAnnyFitDispatchRequest(value: unknown): AnnyFitDispatchRequest | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.frontImagePath !== 'string'
    || value.frontImagePath.length === 0
    || typeof value.sideImagePath !== 'string'
    || value.sideImagePath.length === 0
    || typeof value.heightCm !== 'number'
    || !Number.isFinite(value.heightCm)
    || !isCaptureSex(value.sex)
  ) {
    return null;
  }

  if (
    value.weightKg !== undefined
    && (typeof value.weightKg !== 'number' || !Number.isFinite(value.weightKg))
  ) {
    return null;
  }

  return {
    frontImagePath: value.frontImagePath,
    sideImagePath: value.sideImagePath,
    heightCm: value.heightCm,
    sex: value.sex,
    ...(value.weightKg === undefined ? {} : { weightKg: value.weightKg }),
  };
}

export function isValidAnnyFitDispatch(payload: AnnyFitDispatchRequest): boolean {
  const frontPath = parseBiometricJobImagePath(payload.frontImagePath);
  const sidePath = parseBiometricJobImagePath(payload.sideImagePath);

  return (
    frontPath !== null
    && sidePath !== null
    && isBiometricAssetPath(payload.frontImagePath)
    && isBiometricAssetPath(payload.sideImagePath)
    && frontPath.view === 'front'
    && sidePath.view === 'side'
    && frontPath.tenantId === sidePath.tenantId
    && frontPath.jobId === sidePath.jobId
    && payload.heightCm >= 50
    && payload.heightCm <= 250
    && (payload.weightKg === undefined || (payload.weightKg >= 10 && payload.weightKg <= 400))
  );
}
