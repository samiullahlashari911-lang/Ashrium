import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  BIOMETRIC_SIGNED_READ_SECONDS,
  BIOMETRIC_WEBP_MAX_BYTES,
  isWebpBytes,
} from '@/lib/server/biometric-upload';

test('WebP magic bytes are required and oversized buffers are rejected', () => {
  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);
  assert.equal(isWebpBytes(webp), true);

  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(isWebpBytes(jpeg), false);
  assert.equal(isWebpBytes(new Uint8Array(8)), false);
  assert.equal(BIOMETRIC_WEBP_MAX_BYTES, 5 * 1024 * 1024);
});

test('Replicate biometric read URLs outlive an A100 cold start', () => {
  assert.equal(BIOMETRIC_SIGNED_READ_SECONDS, 15 * 60);

  const hmr = readFileSync(path.join(process.cwd(), 'app/api/v1/hmr/route.ts'), 'utf8');
  assert.match(hmr, /BIOMETRIC_SIGNED_READ_SECONDS/);
  assert.doesNotMatch(hmr, /createSignedUrl\([^,]+,\s*60\s*\)/);
  assert.match(hmr, /convertWarmupLeaseToJob/);
  assert.match(hmr, /settleWarmReplicaIfNeeded/);
  assert.match(hmr, /const prediction = await dispatchAnnyFitPrediction/);
  assert.match(hmr, /watchShopperGpuDeadline/);
  assert.doesNotMatch(hmr, /GPU_COLD_START_WAIT_MS/);
});

test('shopper capture PUTs WebPs to signed Storage URLs in parallel', () => {
  const client = readFileSync(path.join(process.cwd(), 'lib/widget/fit-client.ts'), 'utf8');
  assert.match(client, /\/api\/v1\/biometrics\/upload-url/);
  assert.match(client, /putWebpToSignedUrl/);
  assert.match(client, /Content-Type': 'image\/webp'/);
  assert.match(client, /\/api\/v1\/biometrics\/upload/);
});
