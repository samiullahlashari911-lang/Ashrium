import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fitPhotoLighting, lightForShader, lightingAt, linearToSrgb, srgbToLinear } from '@/lib/graphics/photo-lighting';

/** Skin seen at many angles under a key light from upper left, plus ambient. */
function skin(count: number, outliers = 0): { normals: Float32Array; luminance: Float32Array } {
  const normals = new Float32Array(count * 3);
  const luminance = new Float32Array(count);
  const light = [-0.17, 0.22, 0.12];
  let seed = 7;
  const random = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < count; i += 1) {
    const theta = random() * Math.PI * 2;
    const z = random();
    const r = Math.sqrt(1 - z * z);
    const n = [r * Math.cos(theta), r * Math.sin(theta), z];
    normals.set(n, i * 3);
    luminance[i] = 0.5 + light[0] * n[0] + light[1] * n[1] + light[2] * n[2];
    if (i < outliers) {
      luminance[i] *= 0.15; // a dark beard
    }
  }
  return { normals, luminance };
}

test('the light is read back from skin seen at many angles', () => {
  const { normals, luminance } = skin(2000);
  const lighting = fitPhotoLighting(normals, luminance);
  assert.ok(lighting);
  const { direction } = lightForShader(lighting);
  assert.ok(direction[0] < -0.4 && direction[1] > 0.6, `direction ${direction.map((v) => v.toFixed(2))}`);
  assert.ok(Math.abs(lightingAt(lighting, 0, 0, 1) - 0.62) < 0.01);
});

test('a beard or lips do not tilt the light', () => {
  const clean = fitPhotoLighting(...Object.values(skin(2000)) as [Float32Array, Float32Array]);
  const bearded = fitPhotoLighting(...Object.values(skin(2000, 300)) as [Float32Array, Float32Array]);
  assert.ok(clean && bearded);
  const a = lightForShader(clean).direction;
  const b = lightForShader(bearded).direction;
  assert.ok(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] > 0.97);
});

test('too little skin is not trusted, and a hard light is softened, never inverted', () => {
  const few = skin(100);
  assert.equal(fitPhotoLighting(few.normals, few.luminance), null);
  const hard = skin(2000);
  for (let i = 0; i < hard.luminance.length; i += 1) {
    hard.luminance[i] = Math.max(0, hard.luminance[i] - 0.45);
  }
  const lighting = fitPhotoLighting(hard.normals, hard.luminance);
  assert.ok(lighting && lighting.ambient > 0);
  assert.ok(lightForShader(lighting).ambientShare >= 0.15);
});

test('sRGB and linear round-trip', () => {
  for (const v of [0, 12, 128, 200, 255]) {
    assert.ok(Math.abs(linearToSrgb(srgbToLinear(v)) - v) < 0.01);
  }
});

test('a fit fooled into a light from behind is refused, not used', () => {
  const { normals, luminance } = skin(2000);
  // Camera-facing skin far darker than the rest (a full beard over the face): the light would point away.
  for (let i = 0; i < luminance.length; i += 1) {
    luminance[i] = 0.6 - 0.3 * normals[i * 3 + 2];
  }
  assert.equal(fitPhotoLighting(normals, luminance), null);
});
