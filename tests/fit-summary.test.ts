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
