import assert from 'node:assert/strict';
import { test } from 'node:test';

import { gpuProgressCallbackUrl, verifyGpuCallback } from '@/lib/server/gpu-callback-auth';
import { GPU_HOLD_DURING_DRAPE_MS } from '@/lib/ml/session-gpu';
import {
  REVEAL_HOLD_MAX_MS,
  avatarStageViews,
  currentAvatarStage,
  isAvatarStageKey,
} from '@/lib/widget/avatar-stages';

// Same vector as gpu/tests/test_progress.py — Python signs, TypeScript verifies.
const SECRET = 'ashrium-test-secret-0001';
const BODY = '{"job_id":"j","stage":"body","tenant_id":"t"}';
const SIGNATURE = 'ed39c29ac520571617036b0f45022cc26369d3f8e4da91bd0cca269238d035ff';

test('loader stage follows what the client can prove, never a timer', () => {
  assert.equal(currentAvatarStage({ uploading: true, jobStatus: null, gpuStage: null }), 'upload');
  assert.equal(currentAvatarStage({ uploading: false, jobStatus: 'pending', gpuStage: null }), 'gpu');
  assert.equal(currentAvatarStage({ uploading: false, jobStatus: 'processing', gpuStage: null }), 'body');
  assert.equal(
    currentAvatarStage({ uploading: false, jobStatus: 'processing', gpuStage: 'silhouettes' }),
    'silhouettes',
  );
  assert.equal(currentAvatarStage({ uploading: false, jobStatus: 'pending', gpuStage: 'crop' }), 'gpu');
  assert.equal(currentAvatarStage({ uploading: false, jobStatus: 'completed', gpuStage: 'body' }), 'ready');
});

test('stage views mark earlier stages done and later ones pending', () => {
  const views = avatarStageViews('body');
  assert.equal(views.find((view) => view.key === 'upload')?.state, 'done');
  assert.equal(views.find((view) => view.key === 'body')?.state, 'active');
  assert.equal(views.find((view) => view.key === 'measure')?.state, 'pending');
  assert.equal(isAvatarStageKey('measure'), true);
  assert.equal(isAvatarStageKey('dance'), false);
});

test('after the GPU job the loader holds until the avatar is built and dressed', () => {
  const completed = { uploading: false, jobStatus: 'completed', gpuStage: 'measure' } as const;
  assert.equal(currentAvatarStage({ ...completed, reveal: 'place' }), 'place');
  assert.equal(currentAvatarStage({ ...completed, reveal: 'dress' }), 'dress');
  assert.equal(currentAvatarStage({ ...completed, reveal: 'ready' }), 'ready');
  // Not every product gets a drape: a skipped stage is never claimed as done.
  const views = avatarStageViews('ready', new Set(['dress']));
  assert.equal(views.some((view) => view.key === 'dress'), false);
  assert.equal(views.find((view) => view.key === 'place')?.state, 'done');
  assert.equal(avatarStageViews('dress').find((view) => view.key === 'dress')?.state, 'active');
});

test('GPU stage callbacks verify the Modal HMAC and reject stale or tampered calls', () => {
  const previous = process.env.ASHRIUM_GPU_HMAC;
  process.env.ASHRIUM_GPU_HMAC = SECRET;
  try {
    const nowSeconds = 1_700_000_010;
    assert.equal(
      verifyGpuCallback({ rawBody: BODY, timestamp: '1700000000', signature: SIGNATURE, nowSeconds }),
      true,
    );
    assert.equal(
      verifyGpuCallback({ rawBody: `${BODY} `, timestamp: '1700000000', signature: SIGNATURE, nowSeconds }),
      false,
    );
    assert.equal(
      verifyGpuCallback({
        rawBody: BODY,
        timestamp: '1700000000',
        signature: SIGNATURE,
        nowSeconds: 1_700_000_000 + 301,
      }),
      false,
    );
    assert.equal(verifyGpuCallback({ rawBody: BODY, timestamp: null, signature: SIGNATURE }), false);
  } finally {
    if (previous === undefined) {
      delete process.env.ASHRIUM_GPU_HMAC;
    } else {
      process.env.ASHRIUM_GPU_HMAC = previous;
    }
  }
});

test('progress callbacks are only offered on an HTTPS app URL', () => {
  const previous = process.env.APP_BASE_URL;
  try {
    process.env.APP_BASE_URL = 'https://www.ashrium.org';
    assert.equal(gpuProgressCallbackUrl(), 'https://www.ashrium.org/api/v1/hmr/progress');
    process.env.APP_BASE_URL = 'http://localhost:3000';
    assert.equal(gpuProgressCallbackUrl(), null);
  } finally {
    if (previous === undefined) {
      delete process.env.APP_BASE_URL;
    } else {
      process.env.APP_BASE_URL = previous;
    }
  }
});

test('two shoppers share one A100: containers scale to ceil(occupancy / 2)', async () => {
  const { containersForOccupancy, shopperGpuCapacity, SHOPPER_GPU_SLOTS_PER_CONTAINER } = await import(
    '@/lib/ml/session-gpu'
  );
  assert.equal(SHOPPER_GPU_SLOTS_PER_CONTAINER, 2);
  assert.equal(containersForOccupancy(0), 0);
  assert.equal(containersForOccupancy(1), 1);
  assert.equal(containersForOccupancy(2), 1);
  assert.equal(containersForOccupancy(3), 2);
  assert.equal(shopperGpuCapacity(3), 6);
});

test('on-device face never reaches an upload path and is shown to every shopper', async () => {
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const read = (file: string): string => readFileSync(path.join(process.cwd(), file), 'utf8');
  const fitClient = read('lib/widget/fit-client.ts');
  const capture = read('components/widget/guided-capture/guided-capture.tsx');
  const viewport = read('components/widget/StorefrontViewport.tsx');
  const encoder = read('lib/widget/webp-encode.ts');

  // The upload/dispatch client has no notion of a face at all.
  assert.doesNotMatch(fitClient, /OnDeviceFace|frontFace|faceImage/);
  // The dispatch call is built from the headless blobs only.
  assert.match(capture, /frontBlob,\s*\n\s*sideBlob: blob,/);
  assert.doesNotMatch(capture, /uploadDualWebpAndDispatch\([^)]*frontFace/);
  // Face crops are canvases, not Blobs, so FormData/fetch cannot take them by accident.
  assert.match(encoder, /export type OnDeviceFace = HTMLCanvasElement;/);
  // No merchant or shopper switch: the storefront always keeps the face on device.
  assert.match(viewport, /faceImage=\{result\.face\}/);
  assert.match(viewport, /^\s*captureFace$/m);
});

test('the loader never gives up on a drape the server still allows', () => {
  // A 90 s cap revealed an undressed avatar while a 120 s Newton drape ran.
  assert.ok(REVEAL_HOLD_MAX_MS > GPU_HOLD_DURING_DRAPE_MS);
  assert.ok(REVEAL_HOLD_MAX_MS - GPU_HOLD_DURING_DRAPE_MS <= 30_000, 'but not open-ended');
});
