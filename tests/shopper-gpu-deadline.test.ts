import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  SHOPPER_GPU_TIMEOUT_MESSAGE,
  SHOPPER_INFERENCE_DEADLINE_MS,
  gpuHoldMsUntilDeadline,
  isShopperInferenceOverdue,
} from '@/lib/ml/session-gpu';

test('shopper GPU wall clock is two minutes', () => {
  assert.equal(SHOPPER_INFERENCE_DEADLINE_MS, 120_000);
  const created = new Date('2026-01-01T00:00:00.000Z').toISOString();
  assert.equal(isShopperInferenceOverdue(created, Date.parse('2026-01-01T00:01:59.000Z')), false);
  assert.equal(isShopperInferenceOverdue(created, Date.parse('2026-01-01T00:02:00.000Z')), true);
  assert.equal(gpuHoldMsUntilDeadline(created, Date.parse('2026-01-01T00:01:30.000Z')), 30_000);
  assert.equal(gpuHoldMsUntilDeadline(created, Date.parse('2026-01-01T00:03:00.000Z')), 0);
  assert.match(SHOPPER_GPU_TIMEOUT_MESSAGE, /Sorry/);
  assert.match(SHOPPER_GPU_TIMEOUT_MESSAGE, /2 minutes/);
});

test('HMR dispatch warms the GPU, then watches the two-minute deadline', () => {
  const hmr = readFileSync(path.join(process.cwd(), 'app/api/v1/hmr/route.ts'), 'utf8');
  const warmup = readFileSync(path.join(process.cwd(), 'app/api/v1/hmr/warmup/route.ts'), 'utf8');
  const replicate = readFileSync(path.join(process.cwd(), 'lib/ml/replicate.ts'), 'utf8');
  const abort = readFileSync(path.join(process.cwd(), 'lib/server/abort-shopper-gpu.ts'), 'utf8');
  const capture = readFileSync(
    path.join(process.cwd(), 'components/widget/guided-capture/guided-capture.tsx'),
    'utf8',
  );
  const client = readFileSync(path.join(process.cwd(), 'lib/widget/fit-client.ts'), 'utf8');
  const cogFit = readFileSync(path.join(process.cwd(), 'cog/body/mhr_fit.py'), 'utf8');
  const cogPredict = readFileSync(path.join(process.cwd(), 'cog/predict.py'), 'utf8');

  assert.match(hmr, /warmAndWaitForShopperGpu/);
  assert.match(hmr, /await warmGpu/);
  assert.match(hmr, /watchShopperGpuDeadline/);
  assert.match(hmr, /maxDuration = 130/);
  assert.match(warmup, /watchWarmGpuIdleTimeout/);
  assert.match(warmup, /warmGpuForShopperSubmit/);
  assert.match(replicate, /cancelReplicatePrediction/);
  assert.match(abort, /cancelReplicatePrediction/);
  assert.match(abort, /SHOPPER_GPU_TIMEOUT_MESSAGE/);
  assert.match(abort, /latest.status !== 'pending'/);
  assert.match(capture, /SHOPPER_INFERENCE_DEADLINE_MS/);
  assert.match(capture, /warmShopperGpu/);
  assert.match(client, /\/api\/v1\/hmr\/warmup/);
  assert.match(cogFit, /FIT_STEPS = 20/);
  assert.match(cogPredict, /max_side: int = 640/);
});
