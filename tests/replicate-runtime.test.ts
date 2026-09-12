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
  GPU_HOLD_AFTER_BODY_MS,
  GPU_HOLD_DURING_DRAPE_MS,
  REPLICATE_A100_USD_PER_SEC,
  SESSION_GPU_SAFETY_TIMEOUT_MS,
  readShopperGpuMaxInstances,
  sessionGpuShouldSleep,
  shopperGpuOccupancy,
} from '@/lib/ml/session-gpu';
import {
  MHR_BODY_IDENTITY_DIM,
  MHR_JOINT_COUNT,
  MHR_JOINT_QUAT_DIM,
  MHR_MODEL_PARAM_DIM,
  MHR_SKELETON_DIM,
  MHR_SKELETON_STATE_DIM,
  MHR_TOPOLOGY_VERSION,
  MHR_VERTEX_COUNT,
} from '@/types/hmr';

test('session GPU stays warm through body and drape, then sleeps', () => {
  assert.equal(SESSION_GPU_SAFETY_TIMEOUT_MS, 2 * 60 * 1000);
  assert.equal(GPU_HOLD_AFTER_BODY_MS, 2 * 60 * 1000);
  assert.equal(GPU_HOLD_DURING_DRAPE_MS, 2 * 60 * 1000);
  assert.equal(REPLICATE_A100_USD_PER_SEC, 0.0014);
  assert.equal(sessionGpuShouldSleep({ activeBodyJobCount: 1, activeDrapeHoldCount: 0 }), false);
  assert.equal(sessionGpuShouldSleep({ activeBodyJobCount: 0, activeDrapeHoldCount: 1 }), false);
  assert.equal(sessionGpuShouldSleep({ activeBodyJobCount: 0, activeDrapeHoldCount: 0 }), true);
  assert.equal(
    sessionGpuShouldSleep({ activeBodyJobCount: 0, activeDrapeHoldCount: 0, warmupLeaseCount: 1 }),
    false,
  );
  assert.equal(shopperGpuOccupancy({ activeBodyJobCount: 1, warmupLeaseCount: 1 }), 2);
  assert.equal(readShopperGpuMaxInstances(''), 3);
  assert.equal(readShopperGpuMaxInstances('3'), 3);
  assert.equal(readShopperGpuMaxInstances('12'), 8);
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
  assert.equal(MHR_JOINT_COUNT, 127);
  assert.equal(MHR_JOINT_QUAT_DIM, 508);
  assert.equal(MHR_VERTEX_COUNT, 18439);
  assert.equal(MHR_SKELETON_STATE_DIM, 8);
  assert.equal(MHR_MODEL_PARAM_DIM, 204);

  const jointRotations = Array.from({ length: MHR_JOINT_QUAT_DIM }, (_, index) => (
    index % 4 === 3 ? 1 : 0
  ));
  const vertices = Array.from({ length: MHR_VERTEX_COUNT * 3 }, () => 0);
  const parsed = parseMhrParametricVector({
    topology_version: MHR_TOPOLOGY_VERSION,
    shape: Array.from({ length: MHR_BODY_IDENTITY_DIM }, (_, index) => index * 0.01),
    skeleton: Array.from({ length: MHR_SKELETON_DIM }, () => 1),
    pose: Array.from({ length: MHR_MODEL_PARAM_DIM }, () => 0),
    joint_rotations: jointRotations,
    derived_measurements: { chest_cm: 98.4, waist_cm: 81.2, hip_cm: 102.7 },
    stated_weight_kg: 72,
    height_residual_cm: 0.4,
    clothing_residual: 0.12,
    vertex_positions: vertices,
    fit_diagnostics: {
      iteration_count: 8,
      native_joint_rmse_cm: 1.15,
      height_residual_cm: 0.4,
      silhouette_residual: 0.07,
      stage_timings_ms: {
        setup: 18000,
        sam2_front: 210,
        sam2_side: 198,
        sam3d_front: 2400,
        sam3d_side: 2350,
        mhr_fit: 9100,
        serialization: 420,
      },
    },
  });

  assert.equal(parsed.topology_version, MHR_TOPOLOGY_VERSION);
  assert.equal(parsed.shape.length, MHR_BODY_IDENTITY_DIM);
  assert.equal(parsed.skeleton.length, MHR_SKELETON_DIM);
  assert.equal(parsed.joint_rotations.length, MHR_JOINT_QUAT_DIM);
  assert.equal(parsed.derived_measurements.chest_cm, 98.4);
  assert.equal(parsed.stated_weight_kg, 72);
  assert.equal(parsed.vertex_positions?.length, MHR_VERTEX_COUNT * 3);
  assert.equal(parsed.fit_diagnostics?.iteration_count, 8);
  assert.equal(parsed.fit_diagnostics?.native_joint_rmse_cm, 1.15);
  assert.equal(parsed.fit_diagnostics?.height_residual_cm, 0.4);
  assert.equal(parsed.fit_diagnostics?.silhouette_residual, 0.07);
  assert.equal(parsed.fit_diagnostics?.stage_timings_ms?.mhr_fit, 9100);
  assert.equal(parsed.fit_diagnostics?.stage_timings_ms?.sam2_front, 210);
  assert.equal(parsed.fit_diagnostics?.stage_timings_ms?.sam2_side, 198);
  assert.equal(parsed.fit_diagnostics?.stage_timings_ms?.sam3d_front, 2400);
  assert.equal(parsed.fit_diagnostics?.stage_timings_ms?.sam3d_side, 2350);
  assert.equal(parsed.fit_diagnostics?.stage_timings_ms?.setup, 18000);
  assert.equal(parsed.fit_diagnostics?.stage_timings_ms?.serialization, 420);

  const withoutDiagnostics = parseMhrParametricVector({
    topology_version: MHR_TOPOLOGY_VERSION,
    shape: Array.from({ length: MHR_BODY_IDENTITY_DIM }, () => 0),
    skeleton: Array.from({ length: MHR_SKELETON_DIM }, () => 1),
    pose: Array.from({ length: MHR_MODEL_PARAM_DIM }, () => 0),
    derived_measurements: { chest_cm: 90, waist_cm: 70, hip_cm: 95 },
    vertex_positions: vertices,
    fit_diagnostics: 'not-an-object',
  });
  assert.equal(withoutDiagnostics.fit_diagnostics, undefined);

  const stripped = parseMhrParametricVector({
    topology_version: MHR_TOPOLOGY_VERSION,
    shape: Array.from({ length: MHR_BODY_IDENTITY_DIM }, () => 0),
    skeleton: Array.from({ length: MHR_SKELETON_DIM }, () => 1),
    pose: Array.from({ length: MHR_MODEL_PARAM_DIM }, () => 0),
    derived_measurements: { chest_cm: 90, waist_cm: 70, hip_cm: 95 },
    vertex_positions: vertices,
    fit_diagnostics: {
      iteration_count: 5,
      mask: 'secret',
      landmarks: [1, 2, 3],
      stage_timings_ms: {
        mhr_fit: 100,
        secret_photo_ms: 9,
      },
    },
  });
  assert.equal(stripped.fit_diagnostics?.iteration_count, 5);
  assert.equal(stripped.fit_diagnostics?.stage_timings_ms?.mhr_fit, 100);
  assert.equal(
    stripped.fit_diagnostics && 'mask' in stripped.fit_diagnostics,
    false,
  );
  assert.equal(stripped.fit_diagnostics?.stage_timings_ms && 'secret_photo_ms' in stripped.fit_diagnostics.stage_timings_ms, false);

  assert.throws(() => parseMhrParametricVector({
    topology_version: 'anny-13380-104',
    shape: Array.from({ length: MHR_BODY_IDENTITY_DIM }, () => 0),
    skeleton: Array.from({ length: MHR_SKELETON_DIM }, () => 1),
    pose: Array.from({ length: MHR_MODEL_PARAM_DIM }, () => 0),
    derived_measurements: { chest_cm: 90, waist_cm: 70, hip_cm: 95 },
  }));

  assert.throws(() => parseMhrParametricVector({
    topology_version: MHR_TOPOLOGY_VERSION,
    shape: Array.from({ length: MHR_BODY_IDENTITY_DIM }, () => 0),
    skeleton: Array.from({ length: MHR_SKELETON_DIM }, () => 1),
    pose: Array.from({ length: MHR_MODEL_PARAM_DIM }, () => 0),
    joint_rotations: jointRotations,
    derived_measurements: { chest_cm: 90, waist_cm: 70, hip_cm: 95 },
    vertex_positions: [0, 172, 0],
  }));

  assert.throws(() => parseMhrParametricVector({
    topology_version: MHR_TOPOLOGY_VERSION,
    shape: Array.from({ length: MHR_BODY_IDENTITY_DIM }, () => 0),
    skeleton: Array.from({ length: MHR_SKELETON_DIM }, () => 1),
    pose: Array.from({ length: MHR_MODEL_PARAM_DIM }, () => 0),
    derived_measurements: { chest_cm: 90, waist_cm: 70, hip_cm: 95 },
  }));
});
