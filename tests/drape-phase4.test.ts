import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mhrSimulationCacheVector } from '@/lib/fit/mhr-cache-vector';
import { decimateToMhrLod3 } from '@/lib/graphics/mhr-lod3';
import { parseDrapeSimOutput } from '@/lib/ml/replicate';
import {
  MHR_LOD3_VERTEX_MAX,
  MHR_LOD3_VERTEX_MIN,
  MHR_TOPOLOGY_VERSION,
} from '@/types/hmr';

test('MHR cache vectors are length 6 and change with girths', () => {
  const slim = mhrSimulationCacheVector({
    measurements: { chest_cm: 88, waist_cm: 70, hip_cm: 92 },
    heightCm: 165,
  });
  const broad = mhrSimulationCacheVector({
    measurements: { chest_cm: 110, waist_cm: 90, hip_cm: 112 },
    heightCm: 165,
  });

  assert.equal(slim.length, 6);
  assert.equal(broad.length, 6);
  assert.notDeepEqual(slim, broad);
});

test('parseDrapeSimOutput requires MHR topology and matching array lengths', () => {
  const parsed = parseDrapeSimOutput({
    task: 'drape',
    topology_version: MHR_TOPOLOGY_VERSION,
    vertex_count: 3,
    rest_positions: [0, 1, 0, 0.1, 1, 0, 0, 1, 0.1],
    delta: [0, -0.01, 0, 0, -0.01, 0, 0, -0.02, 0],
    strain: [0.01, 0.02, 0.01],
    clearance_cm: [4, 8, 12],
    indices: [0, 1, 2],
    mean_strain: 0.013,
  });

  assert.equal(parsed.topologyVersion, MHR_TOPOLOGY_VERSION);
  assert.equal(parsed.vertexCount, 3);
  assert.equal(parsed.clearanceCm[2], 12);

  assert.throws(() => parseDrapeSimOutput({
    topology_version: 'anny-13380-104',
    vertex_count: 3,
    rest_positions: [0, 1, 0, 0.1, 1, 0, 0, 1, 0.1],
    delta: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    strain: [0, 0, 0],
    clearance_cm: [1, 1, 1],
    indices: [0, 1, 2],
  }));
});

test('LOD 3 decimation stays inside the collider vertex band', () => {
  const rows = 90;
  const cols = 90;
  const positions = new Float32Array(rows * cols * 3);
  const faces: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      positions[index * 3] = (col / (cols - 1) - 0.5) * 0.4;
      positions[index * 3 + 1] = (row / (rows - 1)) * 1.7;
      positions[index * 3 + 2] = Math.sin((col / cols) * Math.PI * 2) * 0.12;
      if (row + 1 < rows && col + 1 < cols) {
        const a = index;
        const b = index + 1;
        const c = index + cols;
        const d = c + 1;
        faces.push(a, c, b, b, c, d);
      }
    }
  }

  const lod3 = decimateToMhrLod3(positions, new Uint32Array(faces));
  const count = lod3.positions.length / 3;
  assert.ok(count >= MHR_LOD3_VERTEX_MIN, `LOD 3 vertex count ${count} below min`);
  assert.ok(count <= MHR_LOD3_VERTEX_MAX, `LOD 3 vertex count ${count} above max`);
  assert.ok(lod3.indices.length >= 24);
});
