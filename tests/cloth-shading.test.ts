import assert from 'node:assert/strict';
import test from 'node:test';

import { foldOcclusion, seamSmoothNormals } from '@/lib/graphics/cloth-shading';

// Two panels meeting at a seam (x = 0), each a flat quad facing +z, split vertices at the seam.
const SEAM_POSITIONS = [
  -1, 0, 0, 0, 0, 0, 0, 1, 0, -1, 1, 0, // left panel
  0, 0, 0, 1, 0, 0.5, 1, 1, 0.5, 0, 1, 0, // right panel, tilted
];
const SEAM_INDICES = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];

test('split seam vertices share one smooth normal', () => {
  const n = seamSmoothNormals(SEAM_POSITIONS, SEAM_INDICES);
  // Vertex 1 (left panel) and vertex 4 (right panel) sit at the same seam point.
  assert.deepEqual([n[3], n[4], n[5]].map((v) => v.toFixed(5)), [n[12], n[13], n[14]].map((v) => v.toFixed(5)));
  assert.ok(n[5] > 0.9, 'the seam normal still faces out of the cloth');
});

test('the inside of a fold is darker than open cloth', () => {
  // A V-shaped crease along y: the middle row sits back, its neighbours rise in front.
  const positions: number[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      positions.push(col - 2, row, col === 2 ? -0.8 : 0);
    }
  }
  const indices: number[] = [];
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const a = row * 5 + col;
      indices.push(a, a + 1, a + 6, a, a + 6, a + 5);
    }
  }
  const normals = seamSmoothNormals(positions, indices);
  const occlusion = foldOcclusion(positions, normals, indices, { spread: 0 });
  assert.ok(occlusion[7] < occlusion[5], `crease ${occlusion[7]} should be darker than the edge ${occlusion[5]}`);
});

test('the open edges are the hem, not the sewn seams', async () => {
  const { openEdgeRim } = await import('@/lib/graphics/cloth-shading');
  // A 3 x 3 vertex sheet split down the middle into two panels with duplicated seam vertices.
  const positions = [
    0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 2, 0, 1, 2, 0, // left panel x 0..1
    1, 0, 0, 2, 0, 0, 1, 1, 0, 2, 1, 0, 1, 2, 0, 2, 2, 0, // right panel x 1..2 (seam at x = 1 duplicated)
  ];
  const indices = [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 6, 7, 8, 7, 9, 8, 8, 9, 10, 9, 11, 10];
  const rim = openEdgeRim(positions, indices);
  assert.ok(Math.abs(rim[3] - 0.4) < 1e-6, 'the seam centre is not an edge: it sits one ring in');
  assert.ok(Math.abs(rim[8] - 0.4) < 1e-6, 'its duplicate in the other panel agrees');
  assert.equal(rim[0], 1, 'the outline is an edge');
});

test('the form normal keeps the garment’s shape and drops its folds', async () => {
  const { formNormals, seamSmoothNormals } = await import('@/lib/graphics/cloth-shading');
  // A 21 x 21 sheet in the xy plane with a 1 cm ripple along x (folds) on a gentle overall tilt.
  const n = 21;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const x = i * 0.01;
      positions.push(x, j * 0.01, 0.006 * Math.sin((x / 0.04) * Math.PI * 2) + 0.2 * x);
    }
  }
  for (let j = 0; j < n - 1; j += 1) {
    for (let i = 0; i < n - 1; i += 1) {
      const a = j * n + i;
      indices.push(a, a + 1, a + n, a + 1, a + n + 1, a + n);
    }
  }
  const normals = seamSmoothNormals(positions, indices);
  const form = formNormals(positions, indices, normals, 12);
  const centre = 10 * n + 10;
  const spread = (values: Float32Array): number => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 5; i < 16; i += 1) {
      const x = values[(10 * n + i) * 3];
      min = Math.min(min, x);
      max = Math.max(max, x);
    }
    return max - min;
  };
  assert.ok(spread(normals) > 0.5, 'the true normals swing across the folds');
  assert.ok(spread(form) < 0.15, `the form normals do not: ${spread(form).toFixed(3)}`);
  // The overall tilt (z rises with x) survives: the form normal leans to -x.
  assert.ok(form[centre * 3] < -0.1);
});
