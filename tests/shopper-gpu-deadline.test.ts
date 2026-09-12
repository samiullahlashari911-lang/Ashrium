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
  const sessionGpu = readFileSync(path.join(process.cwd(), 'lib/server/session-gpu.ts'), 'utf8');
  const abort = readFileSync(path.join(process.cwd(), 'lib/server/abort-shopper-gpu.ts'), 'utf8');
  const capture = readFileSync(
    path.join(process.cwd(), 'components/widget/guided-capture/guided-capture.tsx'),
    'utf8',
  );
  const client = readFileSync(path.join(process.cwd(), 'lib/widget/fit-client.ts'), 'utf8');
  const cogFit = readFileSync(path.join(process.cwd(), 'cog/body/mhr_fit.py'), 'utf8');
  const cogPredict = readFileSync(path.join(process.cwd(), 'cog/predict.py'), 'utf8');
  const cogInit = readFileSync(path.join(process.cwd(), 'cog/body/initializer.py'), 'utf8');
  const cogTopology = readFileSync(path.join(process.cwd(), 'cog/body/topology.py'), 'utf8');
  const cogYaml = readFileSync(path.join(process.cwd(), 'cog/cog.yaml'), 'utf8');
  const applyHmr = readFileSync(path.join(process.cwd(), 'lib/server/apply-hmr-prediction.ts'), 'utf8');

  assert.match(hmr, /convertWarmupLeaseToJob/);
  assert.match(hmr, /settleWarmReplicaIfNeeded/);
  assert.match(hmr, /watchShopperGpuDeadline/);
  assert.match(hmr, /maxDuration = 130/);
  assert.match(warmup, /watchWarmGpuIdleTimeout/);
  assert.match(warmup, /claimShopperGpuSession/);
  assert.match(warmup, /FITTING_ROOM_AT_CAPACITY/);
  assert.match(replicate, /cancelReplicatePrediction/);
  assert.match(replicate, /body\.version = versionId|version: versionId/);
  assert.match(replicate, /status === 409/);
  assert.match(replicate, /deploymentMeetsRequestedScale/);
  assert.match(sessionGpu, /SHOPPER_INFERENCE_DEADLINE_MS/);
  assert.match(sessionGpu, /\.gt\('created_at', cutoff\)/);
  assert.match(sessionGpu, /GPU_WARM_SETTLE_WAIT_MS/);
  assert.match(sessionGpu, /shopper_gpu_sessions/);
  assert.match(sessionGpu, /ASHRIUM_GPU_MAX_INSTANCES|readShopperGpuMaxInstances/);
  assert.match(abort, /cancelReplicatePrediction/);
  assert.match(abort, /SHOPPER_GPU_TIMEOUT_MESSAGE/);
  assert.match(abort, /latest.status !== 'pending'/);
  assert.match(capture, /SHOPPER_INFERENCE_DEADLINE_MS/);
  assert.match(capture, /warmShopperGpu/);
  assert.match(capture, /key=\{step\}/);
  assert.match(client, /\/api\/v1\/hmr\/warmup/);
  assert.match(applyHmr, /purgeBiometricJobImages/);
  assert.match(applyHmr, /isTerminalReplicateStatus/);
  assert.match(cogFit, /FIT_STEPS = 20/);
  assert.match(cogFit, /MIN_FIT_STEPS = 4/);
  assert.match(cogFit, /PLATEAU_PATIENCE = 3/);
  assert.match(cogFit, /project_scale_along_stature_gradient/);
  assert.match(cogFit, /batched_view_model_params/);
  assert.match(cogFit, /skeleton_quaternions/);
  assert.match(cogFit, /pred_joint_coords/);
  assert.match(cogFit, /Do not fit against pred_keypoints_3d/);
  assert.match(cogFit, /Refusing to pad scale_params/);
  assert.match(cogFit, /MHR_SKELETON_POS_START:MHR_SKELETON_POS_END/);
  assert.doesNotMatch(cogFit, /skel_state\[\.\.\., -3:\]/);
  assert.match(cogTopology, /MHR_SKELETON_POS_START = 0/);
  assert.match(cogTopology, /MHR_SKELETON_QUAT_START = 3/);
  assert.match(cogTopology, /MHR_JOINT_QUAT_DIM = MHR_JOINT_COUNT \* 4/);
  assert.match(cogInit, /SAM3D_INFERENCE_TYPE = "body"/);
  assert.match(cogInit, /inference_type=SAM3D_INFERENCE_TYPE/);
  assert.match(cogInit, /extract_loaded_mhr/);
  assert.match(
    cogYaml,
    /--no-build-isolation --no-deps "git\+https:\/\/github.com\/facebookresearch\/sam2.git@/,
  );
  assert.match(cogPredict, /max_side: int = 640/);
  assert.doesNotMatch(cogPredict, /^from drape\./m);
  assert.match(cogPredict, /from drape\.newton_xpbd import drape_newton_xpbd/);
});
