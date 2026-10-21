import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fitRegionsFor, fitSummaryLine, fitWord, summarizeFit } from '@/lib/fit/fit-summary';

test('words follow the heatmap ease bands', () => {
  assert.equal(fitWord(-1, 8), 'tight');
  assert.equal(fitWord(2, 8), 'snug');
  assert.equal(fitWord(10, 8), 'comfortable');
  assert.equal(fitWord(15, 8), 'relaxed');
  assert.equal(fitWord(25, 8), 'loose');
});

test('a tee reports chest and waist from the drape, in plain words', () => {
  const stature = 1.75;
  const positionsY: number[] = [];
  const clearance: number[] = [];
  for (let i = 0; i < 40; i += 1) {
    positionsY.push(0.72 * stature + (i % 5) * 0.005);
    clearance.push(3); // snug at chest
    positionsY.push(0.61 * stature - (i % 5) * 0.005);
    clearance.push(10); // comfortable at waist
    positionsY.push(0.4 * stature);
    clearance.push(40); // hem flare: not a region of a tee
  }
  const summary = summarizeFit({ positionsY, clearanceCm: clearance, floorY: 0, statureM: stature, category: 'tee', easeCm: 8 });
  assert.deepEqual(summary.map((region) => [region.region, region.word]), [['chest', 'snug'], ['waist', 'comfortable']]);
  assert.equal(fitSummaryLine(summary), 'Snug at chest · comfortable at waist');
});

test('no line without enough drape in a region, or for an unknown garment', () => {
  assert.deepEqual(fitRegionsFor('other'), []);
  assert.equal(fitSummaryLine([]), null);
  const sparse = summarizeFit({ positionsY: [1.26], clearanceCm: [3], floorY: 0, statureM: 1.75, category: 'tee', easeCm: 8 });
  assert.deepEqual(sparse, []);
});

test('each size says how much room it leaves on this body, and the words follow the sizes', async () => {
  const { sizeRoom, sizeRoomLine } = await import('@/lib/fit/fit-summary');
  const body = { chest_cm: 96.3, waist_cm: 93.7, hip_cm: 112 };
  const ease = { chestCm: 8, waistCm: 6, hipCm: 6 };
  const sizes = [
    { code: 'S', chestCm: 100.1 },
    { code: 'M', chestCm: 104.9 },
    { code: 'L', chestCm: 110 },
    { code: 'XL', chestCm: 114 },
  ];
  const lines = sizes.map((size) => sizeRoomLine(sizeRoom('tee', { chestCm: size.chestCm, waistCm: 0, hipCm: 0 }, body, ease)));
  assert.deepEqual(lines, [
    '4 cm of room at the chest (snug)',
    '9 cm of room at the chest (comfortable)',
    '14 cm of room at the chest (relaxed)',
    '18 cm of room at the chest (loose)',
  ]);
  assert.equal(
    sizeRoomLine(sizeRoom('pant', { chestCm: 0, waistCm: 90, hipCm: 116 }, body, { chestCm: 4, waistCm: 2, hipCm: 4 })),
    '4 cm smaller than you at the waist · 4 cm of room at the hips (comfortable)',
  );
  assert.equal(sizeRoomLine(sizeRoom('other', { chestCm: 100, waistCm: 0, hipCm: 0 }, body, ease)), null);
});
