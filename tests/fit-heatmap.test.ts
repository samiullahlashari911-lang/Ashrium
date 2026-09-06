import assert from 'node:assert/strict';
import { test } from 'node:test';

import { strainHeatmapRgb } from '@/lib/design-tokens';
import {
  decodeSimDelta,
  encodeSimDelta,
  isCurrentSimDelta,
} from '@/lib/graphics/meshopt-delta';
import { DEFAULT_EASE_CM, mapRadialClearanceToColor } from '@/lib/graphics/radial-heatmap';
import { ANNY_TOPOLOGY_VERSION } from '@/types/hmr';
import type { SimDrapeMesh } from '@/types/graphics';

const EASE_CM = DEFAULT_EASE_CM;

function simDrapeFixture(clearanceCm: Float32Array): SimDrapeMesh {
  const vertexCount = clearanceCm.length;
  return {
    restPositions: new Float32Array(vertexCount * 3).fill(0.5),
    delta: new Float32Array(vertexCount * 3).fill(0.01),
    strain: new Float32Array(vertexCount).fill(0),
    clearanceCm,
    indices: new Uint32Array([0, 1, 2]),
    vertexCount,
    topologyVersion: ANNY_TOPOLOGY_VERSION,
    meanStrain: 0,
  };
}

test('a slack garment reads loose blue, not ideal green', () => {
  // An oversized garment hangs at strain ~= 0, identical to a perfect fit, so
  // this is the case a strain-driven scale silently mis-coloured as "ideal".
  const loose = mapRadialClearanceToColor(EASE_CM * 3, EASE_CM);
  assert.deepEqual(loose, strainHeatmapRgb.loose);

  const ideal = mapRadialClearanceToColor(EASE_CM, EASE_CM);
  assert.deepEqual(ideal, strainHeatmapRgb.ideal);
  assert.notDeepEqual(loose, ideal);
});

test('clearance hits each palette stop in order', () => {
  // The scale is red -> amber -> green -> blue, so no single channel is
  // monotonic across the whole ramp; assert the stops themselves.
  assert.deepEqual(mapRadialClearanceToColor(-1, EASE_CM), strainHeatmapRgb.constricted);
  assert.deepEqual(mapRadialClearanceToColor(0, EASE_CM), strainHeatmapRgb.constricted);
  assert.deepEqual(mapRadialClearanceToColor(EASE_CM * 0.5, EASE_CM), strainHeatmapRgb.snug);
  assert.deepEqual(mapRadialClearanceToColor(EASE_CM * 1.5, EASE_CM), strainHeatmapRgb.ideal);
  assert.deepEqual(mapRadialClearanceToColor(EASE_CM * 2.5, EASE_CM), strainHeatmapRgb.loose);
  assert.deepEqual(mapRadialClearanceToColor(EASE_CM * 10, EASE_CM), strainHeatmapRgb.loose);
});

test('the loose ramp moves steadily toward blue', () => {
  const ramp = [1.5, 1.75, 2, 2.25, 2.5].map((ratio) =>
    mapRadialClearanceToColor(EASE_CM * ratio, EASE_CM),
  );

  for (let index = 1; index < ramp.length; index += 1) {
    assert.ok(
      ramp[index].b > ramp[index - 1].b,
      `blue channel must rise across the loose ramp (step ${index})`,
    );
  }
});

test('ease scales the thresholds so a tight garment is not called loose', () => {
  // 10cm of clearance is ideal on an 8cm-ease tee but loose on a 4cm-ease fit.
  assert.deepEqual(mapRadialClearanceToColor(10, 8), strainHeatmapRgb.ideal);
  assert.deepEqual(mapRadialClearanceToColor(10, 4), strainHeatmapRgb.loose);
});

test('sim delta round-trips the clearance channel', () => {
  const clearanceCm = new Float32Array([-2.5, 0, 4, 12, 24]);
  const encoded = encodeSimDelta(simDrapeFixture(clearanceCm));

  assert.equal(isCurrentSimDelta(encoded), true);

  const decoded = decodeSimDelta(encoded);
  assert.equal(decoded.vertexCount, clearanceCm.length);
  assert.deepEqual(Array.from(decoded.clearanceCm), Array.from(clearanceCm));
});

test('a pre-clearance blob is rejected rather than rendered', () => {
  const encoded = encodeSimDelta(simDrapeFixture(new Float32Array([1, 2, 3])));
  const stale = new Uint8Array(encoded);
  // Rewrite the version field to the pre-clearance schema.
  new DataView(stale.buffer, stale.byteOffset, stale.byteLength).setUint16(4, 1, true);

  assert.equal(isCurrentSimDelta(stale), false);
  assert.throws(() => decodeSimDelta(stale), /Unsupported sim delta version/);
});

test('encoding refuses a mesh whose clearance channel is the wrong length', () => {
  const mesh = simDrapeFixture(new Float32Array([1, 2, 3]));
  const broken: SimDrapeMesh = { ...mesh, clearanceCm: new Float32Array([1, 2]) };

  assert.throws(() => encodeSimDelta(broken), /do not match vertexCount/);
});
