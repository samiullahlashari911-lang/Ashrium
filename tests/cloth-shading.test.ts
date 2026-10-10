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
