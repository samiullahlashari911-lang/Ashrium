import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readShippedMhrHullStamp } from '@/lib/graphics/anny-hull-server';
import { vertexBufferToMeters } from '@/lib/graphics/anny-hull';
import { isTerminalReplicateStatus } from '@/lib/server/apply-hmr-prediction';
import {
  MHR_JOINT_COUNT,
  MHR_TOPOLOGY_VERSION,
  MHR_VERTEX_COUNT,
} from '@/types/hmr';

test('shipped mhr-hull.glb is rest-pose LOD 1 with mhr-18439-127', async () => {
  const stamp = await readShippedMhrHullStamp();
  assert.equal(stamp.topologyVersion, MHR_TOPOLOGY_VERSION);
  assert.equal(stamp.vertexCount, MHR_VERTEX_COUNT);
  assert.equal(stamp.stampedJointCount, MHR_JOINT_COUNT);
  assert.equal(stamp.matchesShippedTopology, true);
});

test('Cog centimetre vertex buffers convert to metres without changing metre meshes', () => {
  const centimeters = [0, 172, 0, 10, 0, 0];
  const fromCm = vertexBufferToMeters(centimeters);
  assert.ok(Math.abs(fromCm[1] - 1.72) < 1e-5);
  assert.ok(Math.abs(fromCm[3] - 0.1) < 1e-5);

  const meters = [0, 1.72, 0, 0.1, 0, 0];
  const fromMeters = vertexBufferToMeters(meters);
  assert.ok(Math.abs(fromMeters[1] - 1.72) < 1e-5);
  assert.ok(Math.abs(fromMeters[3] - 0.1) < 1e-5);
});

test('status-route reconcile only writes terminal Replicate predictions', () => {
  assert.equal(isTerminalReplicateStatus('succeeded'), true);
  assert.equal(isTerminalReplicateStatus('failed'), true);
  assert.equal(isTerminalReplicateStatus('canceled'), true);
  assert.equal(isTerminalReplicateStatus('processing'), false);
  assert.equal(isTerminalReplicateStatus('starting'), false);
});
