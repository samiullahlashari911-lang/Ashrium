import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MODAL_A100_80GB_SKU,
  describeMissingGpuHmac,
  describeMissingModalGpuUrl,
  inspectModalRuntimeConfig,
  parseMhrParametricVector,
  signGpuRequest,
} from '@/lib/ml/gpu';
import {
  GPU_HOLD_AFTER_BODY_MS,
  GPU_HOLD_DURING_DRAPE_MS,
  MODAL_A100_USD_PER_SEC,
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
  assert.equal(MODAL_A100_USD_PER_SEC, 0.000694);
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

test('A100 80GB sku is Modal A100-80GB', () => {
  assert.equal(MODAL_A100_80GB_SKU, 'A100-80GB');
});

test('inspectModalRuntimeConfig fails closed without URL or HMAC', () => {
  const previousUrl = process.env.MODAL_GPU_URL;
  const previousHmac = process.env.ASHRIUM_GPU_HMAC;
  delete process.env.MODAL_GPU_URL;
  delete process.env.ASHRIUM_GPU_HMAC;

  const missing = inspectModalRuntimeConfig();
  assert.equal(missing.urlConfigured, false);
  assert.equal(missing.hmacConfigured, false);
  assert.equal(missing.operatorMessage, describeMissingModalGpuUrl());
  assert.equal(missing.hardware.sku, 'A100-80GB');
  assert.equal(missing.hardware.pinMode, 'modal');
  assert.match(describeMissingGpuHmac(), /ASHRIUM_GPU_HMAC/);

  process.env.MODAL_GPU_URL = 'https://ashrium-vfr-gpu.modal.run';
  const missingHmac = inspectModalRuntimeConfig();
  assert.equal(missingHmac.urlConfigured, true);
  assert.equal(missingHmac.hmacConfigured, false);
  assert.equal(missingHmac.operatorMessage, describeMissingGpuHmac());

  process.env.ASHRIUM_GPU_HMAC = 'x'.repeat(16);
  const ready = inspectModalRuntimeConfig();
  assert.equal(ready.urlConfigured, true);
  assert.equal(ready.hmacConfigured, true);
  assert.equal(ready.operatorMessage, null);
  assert.equal(
    signGpuRequest('{}', '1700000000', 'x'.repeat(16)).length,
    64,
  );

  if (previousUrl === undefined) {
    delete process.env.MODAL_GPU_URL;
  } else {
    process.env.MODAL_GPU_URL = previousUrl;
  }
  if (previousHmac === undefined) {
    delete process.env.ASHRIUM_GPU_HMAC;
  } else {
    process.env.ASHRIUM_GPU_HMAC = previousHmac;
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
