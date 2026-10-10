import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bodyFramePixels,
  createPatchProjector,
  sideCameraSign,
  viewDepth,
} from '@/lib/graphics/mirror-projection';

function slab(): Float32Array {
  // A 40 x 160 x 20 cm block of "body" vertices, 2 cm apart.
  const points: number[] = [];
  for (let x = -0.2; x <= 0.2001; x += 0.02) {
    for (let y = 0; y <= 1.6001; y += 0.02) {
      for (const z of [-0.1, 0.1]) {
        points.push(x, y, z);
      }
    }
  }
  return new Float32Array(points);
}

test('a garment point lands where the photo camera puts the body around it', () => {
  const body = slab();
  // A camera the projector must recover: 400 px per metre, y down, origin at (500, 900).
  const pixels = new Float32Array((body.length / 3) * 2);
  for (let i = 0; i < body.length / 3; i += 1) {
    pixels[i * 2] = 500 + 400 * body[i * 3];
    pixels[i * 2 + 1] = 900 - 400 * body[i * 3 + 1];
  }
  const projector = createPatchProjector(body, pixels);
  const [u, v] = projector.project(0.05, 1.2, 0.12);
  assert.ok(Math.abs(u - 520) < 0.5, `u ${u}`);
  assert.ok(Math.abs(v - 420) < 0.5, `v ${v}`);
});

test('photo_uv on the headless upload maps into the full on-device frame', () => {
  const keepBox = { x: 100, y: 200, width: 800, height: 1000 };
  const pixels = bodyFramePixels([0, 0, 0.5, 1, 1, -0.1], keepBox, 1000, 1400);
  assert.deepEqual(Array.from(pixels), [100, 200, 500, 1200, 900, 100]);
});

test('the side view faces whichever flank the GPU saw', () => {
  const body = new Float32Array([0.2, 1, 0, -0.2, 1, 0, 0.21, 1.1, 0]);
  assert.equal(sideCameraSign(body, [255, 0, 200]), 1);
  assert.equal(sideCameraSign(body, [0, 255, 0]), -1);
  assert.equal(viewDepth('side', -1, 0.2, 0.5), -0.2);
  assert.equal(viewDepth('front', -1, 0.2, 0.5), 0.5);
});
