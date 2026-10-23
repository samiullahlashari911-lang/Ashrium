import assert from 'node:assert/strict';
import { test } from 'node:test';

import { closeGarmentGaps, trimGarmentSpikes } from '@/lib/graphics/garment-gaps';

/** A grey garment layer with a 4 px notch cut into its top edge, and a wide U neckline. */
function layer(width: number, height: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const neckline = x >= 20 && x < 44 && y < 20;
      const notch = x >= 8 && x < 12 && y < 10;
      if (y >= 4 && !neckline && !notch) {
        const o = (y * width + x) * 4;
        rgba.set([80, 80, 80, 255], o);
      }
    }
  }
  return rgba;
}

test('a narrow notch in the garment is closed with its own colour, darkened as inside fabric', () => {
  const width = 64;
  const height = 32;
  const rgba = layer(width, height);
  const allowed = new Uint8Array(width * height).fill(1);
  const added = closeGarmentGaps({ width, height, rgba, allowed, radius: 3, shade: 0.7 });
  assert.ok(added > 0);
  const notch = (6 * width + 10) * 4;
  assert.equal(rgba[notch + 3], 255);
  assert.ok(Math.abs(rgba[notch] - 56) <= 2, `notch colour ${rgba[notch]}`);
});

test('a wide opening (the neckline itself) stays open, and nothing lands where it is not allowed', () => {
  const width = 64;
  const height = 32;
  const rgba = layer(width, height);
  const allowed = new Uint8Array(width * height).fill(1);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      allowed[y * width + x] = 0;
    }
  }
  closeGarmentGaps({ width, height, rgba, allowed, radius: 3, shade: 0.7 });
  assert.equal(rgba[(10 * width + 32) * 4 + 3], 0, 'the middle of the neckline is still open');
  assert.equal(rgba[(6 * width + 10) * 4 + 3], 0, 'the notch is outside the allowed band');
});

test('where the old collar stood beside the neck, the new collar covers it (in the band only)', () => {
  const width = 64;
  const height = 32;
  const rgba = layer(width, height);
  const allowed = new Uint8Array(width * height);
  const oldClothes = new Float32Array(width * height);
  // A wide wedge of old collar inside the neckline opening; only its left half is in the band.
  for (let y = 0; y < 12; y += 1) {
    for (let x = 20; x < 30; x += 1) {
      oldClothes[y * width + x] = 0.9;
      allowed[y * width + x] = x < 25 ? 1 : 0;
    }
  }
  closeGarmentGaps({ width, height, rgba, allowed, radius: 1, shade: 0.7, oldClothes });
  assert.equal(rgba[(6 * width + 22) * 4 + 3], 255);
  assert.equal(rgba[(6 * width + 27) * 4 + 3], 0);
});

test('a thin post of garment beside the neck is trimmed; the garment body stays', () => {
  const width = 40;
  const height = 40;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const body = y >= 20;
      const post = y >= 6 && y < 20 && x >= 10 && x < 13; // 3 px wide, standing up
      if (body || post) {
        rgba.set([60, 60, 60, 255], (y * width + x) * 4);
      }
    }
  }
  const allowed = new Uint8Array(width * height).fill(1);
  const removed = trimGarmentSpikes({ width, height, rgba, allowed, radius: 2 });
  assert.ok(removed >= 3 * 14 - 3, `removed ${removed}`);
  assert.equal(rgba[(10 * width + 11) * 4 + 3], 0, 'post gone');
  assert.equal(rgba[(30 * width + 20) * 4 + 3], 255, 'body kept');
  assert.equal(rgba[(20 * width + 0) * 4 + 3], 255, 'body corner kept');
});
