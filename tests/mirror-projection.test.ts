import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bodyFramePixels,
  createPatchProjector,
  seenTriangles,
  sideCameraSign,
  viewDepth,
} from '@/lib/graphics/mirror-projection';

test('body the photo never saw does not hide the garment (the raised arm cut the sleeve to a rim)', () => {
  // Triangle 0 the camera saw at one corner, triangle 1 not at all (the arm's far side).
  const triangles = new Uint32Array([0, 1, 2, 3, 4, 5]);
  const weight = [0, 180, 0, 0, 0, 0];
  assert.deepEqual(Array.from(seenTriangles(triangles, weight)), [0, 1, 2]);
});

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

test('a garment crossing two body parts lands without a tear (the neckline notches)', () => {
  // Two parts side by side whose photo cameras disagree by 30 px (neck vs shoulder in a posed photo).
  const body = slab();
  const count = body.length / 3;
  const parts = new Uint8Array(count);
  const pixels = new Float32Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    parts[i] = body[i * 3] < 0 ? 0 : 1;
    pixels[i * 2] = 500 + 400 * body[i * 3] + (parts[i] === 1 ? 30 : 0);
    pixels[i * 2 + 1] = 900 - 400 * body[i * 3 + 1];
  }
  const projector = createPatchProjector(body, pixels, parts);
  let previous = projector.project(-0.05, 1.2, 0.12)[0];
  let worst = 0;
  for (let x = -0.049; x <= 0.05; x += 0.001) {
    const [u] = projector.project(x, 1.2, 0.12);
    worst = Math.max(worst, Math.abs(u - previous));
    previous = u;
  }
  assert.ok(worst < 3, `largest step between points 1 mm apart: ${worst.toFixed(1)} px`);
});
