import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { BODY_PART, readBodyParts, replacedParts, skinFillMask } from '@/lib/graphics/body-parts';
import { skinColorFromPixels, skinPatches, type PhotoFrameMeta } from '@/lib/graphics/photo-skin';
import { MHR_VERTEX_COUNT } from '@/types/hmr';

function shippedLabels(): Uint8Array {
  const file = readFileSync('public/models/mhr-parts.bin');
  return readBodyParts(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
}

test('a garment replaces only the clothes it stands for', () => {
  assert.deepEqual([...replacedParts('tee')].sort(), [BODY_PART.upperTorso, BODY_PART.arm].sort());
  assert.deepEqual([...replacedParts('pant')], [BODY_PART.lowerTorsoLegs]);
  assert.equal(replacedParts('dress').size, 3);
  assert.equal(replacedParts('outerwear').size, 0, 'a jacket goes over your own clothes');
  assert.equal(replacedParts(null).size, 0);
  for (const category of ['tee', 'pant', 'dress'] as const) {
    for (const kept of [BODY_PART.head, BODY_PART.hand, BODY_PART.foot]) {
      assert.ok(!replacedParts(category).has(kept), 'head, hands and feet keep the photo');
    }
  }
});

test('shipped labels cover every MHR vertex; a tee fills torso and arms only', () => {
  const labels = shippedLabels();
  assert.equal(labels.length, MHR_VERTEX_COUNT);
  const mask = skinFillMask(labels, 'tee');
  let filled = 0;
  for (let i = 0; i < labels.length; i += 1) {
    const expected = labels[i] === BODY_PART.upperTorso || labels[i] === BODY_PART.arm ? 1 : 0;
    assert.equal(mask[i], expected);
    filled += mask[i]!;
  }
  assert.ok(filled > 2000);
  assert.throws(() => readBodyParts(new ArrayBuffer(10)), /mhr-parts/);
});

test('skin colour ignores beard, hair and glare', () => {
  const pixels: number[] = [];
  const push = (r: number, g: number, b: number, n: number): void => {
    for (let i = 0; i < n; i += 1) pixels.push(r, g, b, 255);
  };
  push(200, 150, 120, 60); // skin
  push(30, 22, 18, 30); // beard / hair
  push(255, 255, 255, 3); // glare
  const colour = skinColorFromPixels(new Uint8ClampedArray(pixels));
  assert.deepEqual(colour, [200, 150, 120]);
  assert.equal(skinColorFromPixels(new Uint8ClampedArray(16)), null);
});

test('skin is read from forehead and cheekbones, clear of the mouth and beard', () => {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
  landmarks[2] = { x: 0.53, y: 0.18, visibility: 1 };
  landmarks[5] = { x: 0.47, y: 0.18, visibility: 1 };
  landmarks[9] = { x: 0.51, y: 0.21, visibility: 1 };
  landmarks[10] = { x: 0.49, y: 0.21, visibility: 1 };
  const frame: PhotoFrameMeta = { keepBox: { x: 0, y: 0, width: 1, height: 1 }, width: 1000, height: 1000, landmarks };
  const patches = skinPatches(frame);
  assert.equal(patches.length, 3);
  const mouthY = 210;
  for (const patch of patches) {
    assert.ok(patch.y + patch.size < mouthY, 'every patch sits above the mouth');
  }
  assert.ok(patches[0]!.y + patches[0]!.size < 180, 'forehead above the eyes');
  landmarks[9] = { x: 0.51, y: 0.21, visibility: 0 };
  assert.deepEqual(skinPatches(frame), []);
});
