import { timingSafeEqual } from 'node:crypto';

import { getGpuHmacSecret, signGpuRequest } from '@/lib/ml/gpu';

/** Same window the Modal app enforces on requests from Vercel. */
export const GPU_CALLBACK_MAX_SKEW_S = 300;

/**
 * Verifies a callback from the Modal app (gpu/progress.py). The signature is
 * HMAC-SHA256 over "{timestamp}.{raw body}" with ASHRIUM_GPU_HMAC — the same
 * scheme Vercel uses toward Modal, so one shared secret covers both ways.
 */
export function verifyGpuCallback(input: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  nowSeconds?: number;
}): boolean {
  const { rawBody, timestamp, signature } = input;
  if (!timestamp || !/^\d+$/.test(timestamp) || !signature) {
    return false;
  }

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > GPU_CALLBACK_MAX_SKEW_S) {
    return false;
  }

  let secret: string;
  try {
    secret = getGpuHmacSecret();
  } catch {
    return false;
  }

  const expected = Buffer.from(signGpuRequest(rawBody, timestamp, secret), 'utf8');
  const provided = Buffer.from(signature.trim().toLowerCase(), 'utf8');
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

/** Absolute URL Modal posts stage callbacks to, or null when not reachable. */
export function gpuProgressCallbackUrl(): string | null {
  const base = process.env.APP_BASE_URL?.trim();
  if (!base) {
    return null;
  }
  try {
    const url = new URL('/api/v1/hmr/progress', base);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}
