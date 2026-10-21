import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { readBodyParts, replacedClothes, vertexFillZones } from '@/lib/graphics/body-parts';
import { FILL_ZONE, pushPullFill, removeReplacedClothes, type ClothesRemovalInput } from '@/lib/graphics/clothes-removal';

/*
 * A 40×60 shopper in a red long top over blue trousers, against a grey wall.
 * The new garment (a tee) covers the chest only, rows 12-27, columns 12-27.
 */
const W = 40;
const H = 60;
const WALL = [200, 200, 200];
const SKIN = [190, 140, 110];
const RED = [200, 30, 40];
const BLUE = [40, 60, 150];

type Region = 'wall' | 'skin' | 'top' | 'trousers';

function scene(): { regions: Region[]; zone: Uint8Array } {
  const regions: Region[] = new Array(W * H).fill('wall');
  const zone = new Uint8Array(W * H).fill(FILL_ZONE.outside);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const p = y * W + x;
      if (y < 10 && x >= 16 && x < 24) {
        regions[p] = 'skin'; // head
        zone[p] = FILL_ZONE.keep;
      } else if (y >= 10 && y < 36 && x >= 12 && x < 28) {
        regions[p] = 'top'; // torso in the old top
        zone[p] = y < 33 ? FILL_ZONE.upper : FILL_ZONE.lower;
      } else if (y >= 10 && y < 24 && ((x >= 6 && x < 12) || (x >= 28 && x < 34))) {
        regions[p] = y < 20 ? 'top' : 'skin'; // arms: old sleeves to row 20, then forearms
        zone[p] = FILL_ZONE.upper;
      } else if (y >= 36 && x >= 13 && x < 27) {
        regions[p] = 'trousers';
        zone[p] = FILL_ZONE.lower;
      }
      // The old top is a little wider than the body at the hip.
      if (y >= 30 && y < 36 && (x === 11 || x === 28)) {
        regions[p] = 'top';
        zone[p] = FILL_ZONE.outside;
      }
    }
  }
  return { regions, zone };
}

function input(overrides: Partial<ClothesRemovalInput> = {}): ClothesRemovalInput {
  const { regions, zone } = scene();
  const photo = new Uint8ClampedArray(W * H * 4);
  const clothes = new Float32Array(W * H);
  const background = new Float32Array(W * H);
  const skin = new Float32Array(W * H);
  const garment = new Uint8Array(W * H);
  regions.forEach((region, p) => {
    const colour = region === 'wall' ? WALL : region === 'skin' ? SKIN : region === 'top' ? RED : BLUE;
    photo.set([...colour, 255], p * 4);
    clothes[p] = region === 'top' || region === 'trousers' ? 0.95 : 0.02;
    background[p] = region === 'wall' ? 0.95 : 0.02;
    skin[p] = region === 'skin' ? 0.95 : 0.02;
    const x = p % W;
    const y = Math.floor(p / W);
    if (y >= 12 && y < 28 && x >= 12 && x < 28) {
      garment[p] = 255;
    }
  });
  return {
    width: W,
    height: H,
    photo,
    clothes,
    background,
    skin,
    garment,
    zone,
    waistRow: 26,
    crotchRow: 40,
    replace: 'top',
    random: () => 0.5,
    ...overrides,
  };
}

function rgb(pixels: Uint8ClampedArray, x: number, y: number): number[] {
  const o = (y * W + x) * 4;
  return [pixels[o], pixels[o + 1], pixels[o + 2]];
}

function near(actual: number[], expected: number[], tolerance = 30): boolean {
  return actual.every((value, i) => Math.abs(value - expected[i]) <= tolerance);
}

test('an old top showing past a new tee becomes skin, trousers or wall, never stays red', () => {
  const result = removeReplacedClothes(input());
  assert.ok(result.pixels, 'something was removed');
  assert.equal(result.unsure, false);
  const out = result.pixels;
  // The collar above the new neckline, on the body above the waistband: skin.
  assert.ok(near(rgb(out, 20, 10), SKIN, 45), `collar → skin, got ${rgb(out, 20, 10)}`);
  // An old sleeve below the new tee's sleeve on the arm: skin.
  assert.ok(near(rgb(out, 8, 15), SKIN, 45), `sleeve → skin, got ${rgb(out, 8, 15)}`);
  // The old hem below the waistband, over the trousers: trousers.
  assert.ok(near(rgb(out, 20, 34), BLUE, 45), `hem → trousers, got ${rgb(out, 20, 34)}`);
  // The old top wider than the body: wall.
  assert.ok(near(rgb(out, 11, 32), WALL, 45), `flare → wall, got ${rgb(out, 11, 32)}`);
  // The head and the new garment's area are untouched.
  assert.deepEqual(rgb(out, 20, 4), SKIN);
  assert.deepEqual(rgb(out, 20, 20), RED, 'under the new garment the photo is left as is');
  // The trousers stay.
  assert.deepEqual(rgb(out, 20, 50), BLUE);
});

test('a covered head (headscarf, hijab) means nothing is removed', () => {
  const base = input();
  const photo = new Uint8ClampedArray(base.photo);
  const clothes = new Float32Array(base.clothes);
  for (let y = 0; y < 10; y += 1) {
    for (let x = 16; x < 24; x += 1) {
      clothes[y * W + x] = 0.9;
      photo.set([60, 60, 70, 255], (y * W + x) * 4);
    }
  }
  const result = removeReplacedClothes({ ...base, photo, clothes });
  assert.equal(result.pixels, null);
  assert.equal(result.unsure, false);
});

test('filled skin darkens toward the body edge', () => {
  // The arm turns away from the camera along its outer columns.
  const facing = new Float32Array(W * H).fill(1);
  for (let y = 0; y < H; y += 1) {
    facing[y * W + 6] = 0;
    facing[y * W + 7] = 0;
  }
  const out = removeReplacedClothes(input({ facing })).pixels;
  assert.ok(out);
  assert.ok(rgb(out, 6, 15)[0] < rgb(out, 10, 15)[0] - 8, 'edge-on skin is darker');
});

test('trousers tried on leave the old top alone', () => {
  const result = removeReplacedClothes(input({ replace: 'bottom' }));
  const out = result.pixels ?? input().photo;
  assert.deepEqual(rgb(out, 20, 10), RED);
  assert.deepEqual(rgb(out, 8, 15), RED);
});

test('an unsure clothes mask removes nothing and says so', () => {
  const unsureClothes = input().clothes.map((value) => (value > 0.5 ? 0.35 : value));
  unsureClothes[10 * W + 20] = 0.9;
  const result = removeReplacedClothes(input({ clothes: unsureClothes }));
  assert.equal(result.pixels, null);
  assert.equal(result.unsure, true);
});

test('no old clothes showing: the photo is kept as taken', () => {
  const none = new Float32Array(W * H);
  const result = removeReplacedClothes(input({ clothes: none }));
  assert.equal(result.pixels, null);
  assert.equal(result.unsure, false);
});

test('push-pull fills holes from the nearest known colour', () => {
  const width = 8;
  const values = new Float32Array(width * 3);
  const weight = new Float32Array(width);
  values.set([10, 10, 10], 0);
  weight[0] = 1;
  values.set([250, 250, 250], 7 * 3);
  weight[7] = 1;
  const filled = pushPullFill(width, 1, values, weight);
  assert.equal(filled[0], 10);
  assert.equal(filled[7 * 3], 250);
  assert.ok(filled[1 * 3] < filled[6 * 3], 'a hole takes after its nearer source');
});

test('the shipped body: a tee replaces tops, trousers bottoms, a jacket nothing', () => {
  assert.equal(replacedClothes('tee'), 'top');
  assert.equal(replacedClothes('pant'), 'bottom');
  assert.equal(replacedClothes('dress'), 'both');
  assert.equal(replacedClothes('outerwear'), null);
  const file = readFileSync('public/models/mhr-parts.bin');
  const labels = readBodyParts(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
  // A stand-in body: labels with heights spread floor to crown.
  const positions = new Float32Array(labels.length * 3);
  for (let i = 0; i < labels.length; i += 1) {
    positions[i * 3 + 1] = labels[i] === 0 ? 1.7 : labels[i] === 5 ? 0 : (i % 100) / 100 * 1.6;
  }
  const zones = vertexFillZones(positions, labels);
  for (let i = 0; i < labels.length; i += 1) {
    if (labels[i] === 0 || labels[i] === 5) {
      assert.equal(zones[i], FILL_ZONE.keep, 'the face and the feet keep the photo');
    }
    if (labels[i] === 4) {
      assert.notEqual(zones[i], FILL_ZONE.keep, 'a shirt cuff over the wrist can go');
    }
  }
  assert.ok(zones.some((zone) => zone === FILL_ZONE.lower));
  assert.ok(zones.some((zone) => zone === FILL_ZONE.upper));
});

test('a white sleeve the mask calls wall is still taken off where the fitted arm certainly is', () => {
  const base = input();
  const photo = new Uint8ClampedArray(base.photo);
  const clothes = new Float32Array(base.clothes);
  const background = new Float32Array(base.background);
  const bodyCertain = new Uint8Array(W * H);
  for (let y = 10; y < 20; y += 1) {
    for (let x = 6; x < 12; x += 1) {
      const p = y * W + x;
      photo.set([236, 236, 232, 255], p * 4); // white cotton against a white wall
      clothes[p] = 0.05;
      background[p] = 0.9;
      if (x >= 7 && x < 11) {
        bodyCertain[p] = 1;
      }
    }
  }
  const missed = removeReplacedClothes({ ...base, photo, clothes, background }).pixels;
  assert.ok(missed && near(rgb(missed, 9, 15), [236, 236, 232], 4), 'without the fitted arm the sleeve stays');
  const out = removeReplacedClothes({ ...base, photo, clothes, background, bodyCertain }).pixels;
  assert.ok(out && near(rgb(out, 9, 15), SKIN, 45), `sleeve on the fitted arm → skin, got ${out && rgb(out, 9, 15)}`);
});

test('filled skin has the texture of the shopper’s own skin: not airbrushed, never rougher', () => {
  const base = input();
  const photo = new Uint8ClampedArray(base.photo);
  // Visible forearm and head skin with a fine ±6% texture.
  for (let p = 0; p < W * H; p += 1) {
    if (base.skin[p] > 0.5) {
      const factor = (p * 7919) % 3 === 0 ? 1.06 : (p * 7919) % 3 === 1 ? 0.94 : 1;
      photo.set([SKIN[0] * factor, SKIN[1] * factor, SKIN[2] * factor, 255], p * 4);
    }
  }
  const out = removeReplacedClothes({ ...base, photo }).pixels;
  assert.ok(out);
  const spread = (xs: number[], ys: number[]): number => {
    const values: number[] = [];
    for (const y of ys) {
      for (const x of xs) {
        values.push(rgb(out, x, y)[0]);
      }
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) / mean;
  };
  // The filled sleeve (old top on the arm, rows 12-17): textured, at most as rough as real skin.
  const filled = spread([7, 8, 9, 10], [12, 13, 14, 15, 16, 17]);
  assert.ok(filled > 0.005, `filled skin is airbrushed: ${filled.toFixed(4)}`);
  assert.ok(filled < 0.08, `filled skin rougher than real skin: ${filled.toFixed(4)}`);
});

test('relit skin follows the light across it and keeps the tone of the skin it came from', () => {
  // Light rising down the arm (as an old white sleeve recorded it).
  const skinLight = new Float32Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      skinLight[y * W + x] = y < 15 ? 0.75 : 1.25;
    }
  }
  const out = removeReplacedClothes(input({ skinLight })).pixels;
  assert.ok(out);
  const row = (y: number): number => [7, 8, 9, 10].reduce((sum, x) => sum + rgb(out, x, y)[0], 0) / 4;
  const top = row(12);
  const bottom = row(18);
  assert.ok(bottom > top + 10, `the lit end is brighter: ${top.toFixed(0)} → ${bottom.toFixed(0)}`);
  const mean = (top + bottom) / 2;
  assert.ok(Math.abs(mean - SKIN[0]) < 15, `tone kept: ${mean.toFixed(0)} vs ${SKIN[0]}`);
});
