import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractGarmentLook, fabricTile, findGarment, keepDetails, type RgbaImage } from '@/lib/graphics/garment-look';
import { drapeLookAttributes, seamVertices } from '@/lib/graphics/garment-print';

/*
 * A 60×100 product photo on a model: a pink knit tee (rows 10-49) with a white
 * logo (rows 20-25, cols 26-33) over beige trousers (rows 50-89), a hand
 * (skin) over the tee's lower right, on a dark wall.
 */
const W = 60;
const H = 100;
const PINK = [230, 170, 180];
const BEIGE = [215, 190, 150];
const WHITE = [250, 250, 250];
const SKIN = [190, 140, 110];
const WALL = [40, 40, 45];

function photo(teeBottom = 50): { image: RgbaImage; clothes: Float32Array } {
  const data = new Uint8ClampedArray(W * H * 4);
  const clothes = new Float32Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      let colour = WALL;
      if (y >= 10 && y < teeBottom && x >= 15 && x < 45) {
        // Knit: a faint vertical rib every 2 px.
        const rib = x % 2 === 0 ? 8 : -8;
        colour = PINK.map((c) => c + rib);
        clothes[i] = 1;
        if (y >= 20 && y < 26 && x >= 26 && x < 34) {
          colour = WHITE;
        }
        if (y >= 38 && y < 46 && x >= 38) {
          colour = SKIN;
          clothes[i] = 0;
        }
      } else if (y >= teeBottom && y < 90 && x >= 17 && x < 43 && !(x >= 29 && x < 31 && y >= 62)) {
        colour = BEIGE;
        clothes[i] = 1;
      }
      data[i * 4] = colour[0];
      data[i * 4 + 1] = colour[1];
      data[i * 4 + 2] = colour[2];
      data[i * 4 + 3] = 255;
    }
  }
  return { image: { width: W, height: H, data }, clothes };
}

test('a top is found above the trousers, its logo kept, the hand left out', () => {
  const { image, clothes } = photo();
  const { region, seen, seedRgb } = findGarment(image, clothes, 'tee');
  const at = (x: number, y: number) => y * W + x;
  assert.equal(region[at(20, 30)], 1, 'tee body');
  assert.equal(region[at(30, 22)], 1, 'logo is inside the tee outline');
  assert.equal(region[at(30, 70)], 0, 'trousers are another garment');
  assert.equal(region[at(5, 5)], 0, 'wall');
  assert.equal(seen[at(40, 42)], 0, 'the hand is not the tee');
  assert.ok(Math.abs(seedRgb[0] - PINK[0] / 255) < 0.06, 'colour is the tee\'s pink');
});

test('a bottom is found below the top', () => {
  // A trousers photo: the model's top is the smaller garment.
  const { image, clothes } = photo(30);
  const { region } = findGarment(image, clothes, 'pant');
  assert.equal(region[70 * W + 20], 1);
  assert.equal(region[20 * W + 20], 0);
});

test('a product shot without a person is found against its backdrop', () => {
  const { image } = photo();
  const { region } = findGarment(image, null, 'tee');
  assert.equal(region[30 * W + 20], 1);
  assert.equal(region[5 * W + 5], 0);
});

test('details come from a product shot, never from a model photo', () => {
  // The tee alone (no hand, no trousers), worn by a model or shot on the backdrop.
  const { image, clothes } = photo();
  const data = new Uint8ClampedArray(image.data);
  for (let i = 0; i < W * H; i += 1) {
    const y = Math.floor(i / W);
    const colour = y >= 50 ? WALL : data[i * 4] === SKIN[0] && data[i * 4 + 1] === SKIN[1] ? PINK : null;
    if (colour) {
      data.set(colour, i * 4);
      clothes[i] = y >= 50 ? 0 : 1;
    }
  }
  const tee = { width: W, height: H, data };
  // On a model, a necklace or hair over the tee would pass as a print.
  assert.equal(extractGarmentLook(tee, clothes, 'tee', 50)?.front, null);
  assert.ok(extractGarmentLook(tee, new Float32Array(W * H), 'tee', 50)?.front, 'a product shot keeps its front details');
});

test('the fabric tile wraps seamlessly and keeps the knit', () => {
  const size = 16;
  const delit = new Float32Array(W * H * 3);
  const seen = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i += 1) {
    const x = i % W;
    const v = x % 2 === 0 ? 0.6 : 0.5;
    delit[i * 3] = v;
    delit[i * 3 + 1] = v;
    delit[i * 3 + 2] = v;
    seen[i] = 1;
  }
  const tile = fabricTile(delit, seen, W, H, size);
  assert.ok(tile);
  assert.equal(tile.width, size);
  // Wrapping: the last column continues into the first like any two neighbours.
  const value = (x: number, y: number) => tile.data[(y * size + x) * 4];
  const across = Math.abs(value(size - 1, 5) - value(0, 5));
  const inside = Math.abs(value(4, 5) - value(5, 5));
  assert.ok(across <= inside + 3, `edge step ${across} vs inner step ${inside}`);
  // The rib survives (columns alternate in brightness).
  assert.ok(Math.abs(value(4, 8) - value(5, 8)) > 5);
});

test('details stay on the front, the plain fabric and its folds go', () => {
  const w = 40;
  const h = 40;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      // Grey jersey with a soft fold (a brightness ramp), a red patch in the middle.
      const fold = Math.round(20 * Math.sin((x / w) * Math.PI));
      const red = x >= 16 && x < 24 && y >= 16 && y < 24;
      data[o] = red ? 200 : 128 + fold;
      data[o + 1] = red ? 40 : 128 + fold;
      data[o + 2] = red ? 40 : 128 + fold;
      data[o + 3] = 255;
    }
  }
  keepDetails({ width: w, height: h, data }, 40);
  assert.ok(data[(20 * w + 20) * 4 + 3] > 200, 'the patch is a detail');
  assert.ok(data[(5 * w + 10) * 4 + 3] < 40, 'a fold is not');
});

test('a whole look comes out of the photo with its fabric at its true size', () => {
  const { image, clothes } = photo();
  const look = extractGarmentLook(image, clothes, 'tee', 50);
  assert.ok(look);
  assert.ok(look.fabricMetres > 0.03 && look.fabricMetres < 0.3, `tile ${look.fabricMetres} m`);
  assert.ok(look.meanRgb[0] > look.meanRgb[2], 'pink');
});

test('seams are where the pattern jumps between pieces', () => {
  // Two triangles side by side in 3D; the second's corner sits on another piece in the pattern.
  const positions = new Float32Array([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0, 0.01, 0.01, 0]);
  const uv = new Float32Array([0, 0, 0.01, 0, 0, 0.01, 0.4, 0.3]);
  const indices = new Uint32Array([0, 1, 2, 1, 3, 2]);
  const seam = seamVertices(positions, uv, indices, 4);
  assert.deepEqual(Array.from(seam), [0, 1, 1, 1]);
});

test('the photo front lands on the front torso, not the sleeves or the back', () => {
  // Body: a torso slab (part 1) at |x| < 0.15 with a front (+z) and back (-z) face, an arm (part 3) at x = 0.3.
  const body: number[] = [];
  const normals: number[] = [];
  const parts: number[] = [];
  for (let y = 1.0; y <= 1.5; y += 0.02) {
    for (let x = -0.15; x <= 0.15; x += 0.02) {
      body.push(x, y, 0.1, x, y, -0.1);
      normals.push(0, 0, 1, 0, 0, -1);
      parts.push(1, 1);
    }
    body.push(0.3, y, 0);
    normals.push(1, 0, 0);
    parts.push(3);
  }
  // Garment: a grid over the front, plus one vertex on the back and one on the arm.
  const garment: number[] = [0, 1.25, -0.11, 0.31, 1.25, 0];
  for (let y = 1.01; y <= 1.495; y += 0.04) {
    for (let x = -0.14; x <= 0.145; x += 0.04) {
      garment.push(x, y, 0.11);
    }
  }
  const draped = new Float32Array(garment);
  const count = draped.length / 3;
  const corner = (x: number, y: number) => {
    let best = 2;
    for (let i = 2; i < count; i += 1) {
      if (Math.hypot(draped[i * 3] - x, draped[i * 3 + 1] - y) < Math.hypot(draped[best * 3] - x, draped[best * 3 + 1] - y)) {
        best = i;
      }
    }
    return best;
  };
  const rows = new Int32Array(20 * 2);
  for (let r = 0; r < 20; r += 1) {
    rows[r * 2] = 2;
    rows[r * 2 + 1] = 17;
  }
  const result = drapeLookAttributes({
    draped,
    uv: new Float32Array(count * 2),
    indices: new Uint32Array([2, 3, 4]),
    vertexCount: count,
    bodyPositions: new Float32Array(body),
    bodyNormals: new Float32Array(normals),
    bodyParts: new Uint8Array(parts),
    category: 'tee',
    frontRows: rows,
    frontWidth: 20,
    frontHeight: 20,
  });
  const middle = corner(0, 1.25);
  const topLeft = corner(-0.14, 1.49);
  const bottomRight = corner(0.14, 1.01);
  assert.equal(result.printWeight[middle], 1, 'front');
  assert.equal(result.printWeight[0], 0, 'back');
  assert.equal(result.printWeight[1], 0, 'sleeve');
  // The front's top-left reads the photo's top-left, its bottom-right the photo's bottom-right.
  assert.ok(result.printUv[topLeft * 2] < 0.3 && result.printUv[topLeft * 2 + 1] < 0.1, `top-left ${result.printUv[topLeft * 2]}`);
  assert.ok(result.printUv[bottomRight * 2] > 0.7 && result.printUv[bottomRight * 2 + 1] > 0.9);
});
