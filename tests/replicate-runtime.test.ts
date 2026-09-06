import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  REPLICATE_A100_80GB_SKU,
  describeMissingReplicateDeployment,
  describeMissingReplicateModelVersion,
  describeMissingReplicateToken,
  getReplicateHardwareSku,
  inspectReplicateRuntimeConfig,
  parseMhrParametricVector,
  parseReplicateDeploymentRef,
  parseReplicateHardwareSku,
} from '@/lib/ml/replicate';
import {
  REPLICATE_A100_USD_PER_SEC,
  SESSION_GPU_SAFETY_TIMEOUT_MS,
} from '@/lib/ml/session-gpu';
import {
  MHR_BODY_IDENTITY_DIM,
  MHR_MODEL_PARAM_DIM,
  MHR_SKELETON_DIM,
  MHR_TOPOLOGY_VERSION,
} from '@/types/hmr';

test('session GPU safety timeout is 45 minutes', () => {
  assert.equal(SESSION_GPU_SAFETY_TIMEOUT_MS, 45 * 60 * 1000);
  assert.equal(REPLICATE_A100_USD_PER_SEC, 0.0014);
});

test('A100 80GB sku is gpu-a100-large and is the default hardware pin', () => {
  assert.equal(REPLICATE_A100_80GB_SKU, 'gpu-a100-large');
  assert.equal(parseReplicateHardwareSku('gpu-a100-large'), 'gpu-a100-large');

  const previous = process.env.REPLICATE_HARDWARE;
  delete process.env.REPLICATE_HARDWARE;
  assert.equal(getReplicateHardwareSku(), 'gpu-a100-large');
  if (previous === undefined) {
    delete process.env.REPLICATE_HARDWARE;
  } else {
    process.env.REPLICATE_HARDWARE = previous;
  }
});

test('deployment refs must be owner/name', () => {
  assert.deepEqual(parseReplicateDeploymentRef('acme/ashrium-vfr-a100'), {
    configured: 'acme/ashrium-vfr-a100',
    owner: 'acme',
    name: 'ashrium-vfr-a100',
  });
  assert.throws(() => parseReplicateDeploymentRef('not-a-deployment'));
});

test('inspectReplicateRuntimeConfig fails closed without token, version, or deployment', () => {
  const previousToken = process.env.REPLICATE_API_TOKEN;
  const previousVersion = process.env.REPLICATE_HMR_MODEL_VERSION;
  const previousHardware = process.env.REPLICATE_HARDWARE;
  const previousDeployment = process.env.REPLICATE_DEPLOYMENT;
  delete process.env.REPLICATE_API_TOKEN;
  delete process.env.REPLICATE_HMR_MODEL_VERSION;
  delete process.env.REPLICATE_HARDWARE;
  delete process.env.REPLICATE_DEPLOYMENT;

  const missing = inspectReplicateRuntimeConfig();
  assert.equal(missing.tokenConfigured, false);
  assert.equal(missing.modelVersionConfigured, false);
  assert.equal(missing.deploymentConfigured, false);
  assert.equal(missing.operatorMessage, describeMissingReplicateToken());
  assert.equal(missing.hardware.sku, 'gpu-a100-large');
  assert.equal(missing.hardware.pinMode, 'model_dashboard');
  assert.match(describeMissingReplicateModelVersion(), /REPLICATE_HMR_MODEL_VERSION/);
  assert.match(describeMissingReplicateDeployment(), /REPLICATE_DEPLOYMENT/);

  process.env.REPLICATE_API_TOKEN = 'r8_test_token';
  process.env.REPLICATE_HMR_MODEL_VERSION = 'a'.repeat(64);
  const missingDeployment = inspectReplicateRuntimeConfig();
  assert.equal(missingDeployment.tokenConfigured, true);
  assert.equal(missingDeployment.modelVersionConfigured, true);
  assert.equal(missingDeployment.deploymentConfigured, false);
  assert.equal(missingDeployment.operatorMessage, describeMissingReplicateDeployment());

  if (previousToken === undefined) {
    delete process.env.REPLICATE_API_TOKEN;
  } else {
    process.env.REPLICATE_API_TOKEN = previousToken;
  }
  if (previousVersion === undefined) {
    delete process.env.REPLICATE_HMR_MODEL_VERSION;
  } else {
    process.env.REPLICATE_HMR_MODEL_VERSION = previousVersion;
  }
  if (previousHardware === undefined) {
    delete process.env.REPLICATE_HARDWARE;
  } else {
    process.env.REPLICATE_HARDWARE = previousHardware;
  }
  if (previousDeployment === undefined) {
    delete process.env.REPLICATE_DEPLOYMENT;
  } else {
    process.env.REPLICATE_DEPLOYMENT = previousDeployment;
  }
});

test('parseMhrParametricVector accepts live Cog body output and rejects ANNY topology', () => {
  const parsed = parseMhrParametricVector({
    topology_version: MHR_TOPOLOGY_VERSION,
    shape: Array.from({ length: MHR_BODY_IDENTITY_DIM }, (_, index) => index * 0.01),
    skeleton: Array.from({ length: MHR_SKELETON_DIM }, () => 1),
    pose: Array.from({ length: MHR_MODEL_PARAM_DIM }, () => 0),
    joint_rotations: [0.1, 0.2, 0.3],
    derived_measurements: { chest_cm: 98.4, waist_cm: 81.2, hip_cm: 102.7 },
    stated_weight_kg: 72,
    height_residual_cm: 0.4,
    clothing_residual: 0.12,
  });

  assert.equal(parsed.topology_version, MHR_TOPOLOGY_VERSION);
  assert.equal(parsed.shape.length, MHR_BODY_IDENTITY_DIM);
  assert.equal(parsed.skeleton.length, MHR_SKELETON_DIM);
  assert.equal(parsed.derived_measurements.chest_cm, 98.4);
  assert.equal(parsed.stated_weight_kg, 72);

  assert.throws(() => parseMhrParametricVector({
    topology_version: 'anny-13380-104',
    shape: Array.from({ length: MHR_BODY_IDENTITY_DIM }, () => 0),
    skeleton: Array.from({ length: MHR_SKELETON_DIM }, () => 1),
    pose: Array.from({ length: MHR_MODEL_PARAM_DIM }, () => 0),
    derived_measurements: { chest_cm: 90, waist_cm: 70, hip_cm: 95 },
  }));
});
