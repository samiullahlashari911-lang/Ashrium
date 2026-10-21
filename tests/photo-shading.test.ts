import assert from 'node:assert/strict';
import { test } from 'node:test';

import { linearToSrgb } from '@/lib/graphics/photo-lighting';
import { photoShading } from '@/lib/graphics/photo-shading';

/** A white shirt lit brighter on the left than the right, with fine weave noise; dark skin patch at the top. */
function scene(width: number, height: number): Parameters<typeof photoShading>[0] {
  const count = width * height;
  const photo = new Uint8ClampedArray(count * 4);
  const clothes = new Float32Array(count);
  const skin = new Float32Array(count);
  const onBody = new Uint8Array(count).fill(1);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const light = 1.2 - 0.4 * (x / (width - 1)); // 1.2 on the left, 0.8 on the right
      const weave = (x + y) % 2 === 0 ? 1.08 : 0.92;
      const isSkin = y < 10;
      const albedo = isSkin ? 0.25 : 0.7;
      const value = linearToSrgb(Math.min(1, albedo * light * (isSkin ? 1 : weave) * 0.9));
      photo.set([value, value, value, 255], pixel * 4);
      (isSkin ? skin : clothes)[pixel] = 0.95;
    }
  }
  return { width, height, photo, clothes, skin, onBody, radius: 4 };
}

test('the light across the body is read from the old clothes and skin, without their weave or albedo', () => {
  const input = scene(80, 60);
  const shading = photoShading(input);
  assert.ok(shading);
  const at = (x: number, y: number): number => shading[y * 80 + x];
  // Left brighter than right, by about the light's 1.2 / 0.8 ratio.
  assert.ok(at(8, 40) > 1.1 && at(72, 40) < 0.9, `left ${at(8, 40).toFixed(2)} right ${at(72, 40).toFixed(2)}`);
  // The weave is gone: neighbours agree.
  assert.ok(Math.abs(at(40, 40) - at(41, 40)) < 0.02);
  // Dark skin and the white shirt meet without a step: each is relative to its own average.
  assert.ok(Math.abs(at(40, 8) - at(40, 12)) < 0.08);
});

test('a photo with too little sure clothing or skin gives no light', () => {
  const input = scene(80, 60);
  input.clothes.fill(0.3);
  input.skin.fill(0.3);
  assert.equal(photoShading(input), null);
});
