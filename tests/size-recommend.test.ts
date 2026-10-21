import assert from 'node:assert/strict';
import test from 'node:test';

import { approximateReasons } from '@/lib/fit/approximate-reasons';
import { recommendSize } from '@/lib/fit/size-recommend';
import type { ConfidenceGateResult, StorefrontSizeVariant } from '@/types/garment';

// Men's High-Waisted Wide-Leg Pants: the owner's 2026-10-10 try-on (fitted waist ~90 cm).
const WIDE_LEG: StorefrontSizeVariant[] = [
  { id: 's', sizeCode: 'S', chestCm: 0, waistCm: 68, hipCm: 110, lengthCm: 102 },
  { id: 'm', sizeCode: 'M', chestCm: 0, waistCm: 72, hipCm: 114, lengthCm: 104 },
  { id: 'l', sizeCode: 'L', chestCm: 0, waistCm: 76, hipCm: 118, lengthCm: 106 },
  { id: 'xl', sizeCode: 'XL', chestCm: 0, waistCm: 80, hipCm: 122, lengthCm: 108 },
];
const OWNER = { chest_cm: 100, waist_cm: 90, hip_cm: 100 };

test('no size fits: the largest is named, but never as a fit', () => {
  const size = recommendSize(OWNER, 'pant', WIDE_LEG);
  assert.equal(size.sizeCode, 'XL');
  assert.equal(size.fits, false);
});

test('a size that fits is marked as fitting', () => {
  const size = recommendSize({ chest_cm: 90, waist_cm: 72, hip_cm: 100 }, 'pant', WIDE_LEG);
  assert.equal(size.sizeCode, 'L');
  assert.equal(size.fits, true);
});

test('a drape that will not come is not "waiting"', () => {
  const gate: ConfidenceGateResult = {
    highConfidence: false,
    capturePassed: true,
    ingestPassed: true,
    residualPassed: true,
    drapePassed: false,
    printPassed: true,
  } as ConfidenceGateResult;
  assert.deepEqual(approximateReasons(gate, { drapeSettled: true, sizeFits: false }), [
    'Your measurements are larger than this size chart',
  ]);
  assert.deepEqual(approximateReasons(gate, { drapeSettled: false, sizeFits: true }), [
    'Waiting for the cloth simulation',
  ]);
});

// Joggers: the chart's waist is the relaxed elastic; it stretches over a bigger waist.
const JOGGERS: StorefrontSizeVariant[] = [
  { id: 'l', sizeCode: 'L', chestCm: 0, waistCm: 72, hipCm: 104, lengthCm: 96 },
  { id: 'xl', sizeCode: 'XL', chestCm: 0, waistCm: 75, hipCm: 108, lengthCm: 98 },
  { id: 'xxl', sizeCode: 'XXL', chestCm: 0, waistCm: 78, hipCm: 112, lengthCm: 100 },
];

test('an elastic waist is sized by the hip, not the relaxed waist', () => {
  const body = { chest_cm: 96, waist_cm: 88, hip_cm: 102 };
  const size = recommendSize(body, 'pant', JOGGERS, { elasticWaist: true });
  assert.equal(size.sizeCode, 'XL');
  assert.equal(size.fits, true);
  assert.equal(recommendSize(body, 'pant', JOGGERS).fits, false);
});

// Men's Crewneck Short Sleeve T-Shirt: the published chest chart (no waist column).
const CREWNECK: StorefrontSizeVariant[] = [
  { id: 's', sizeCode: 'S', chestCm: 100.1, waistCm: 0, hipCm: 0, lengthCm: 62 },
  { id: 'm', sizeCode: 'M', chestCm: 104.9, waistCm: 0, hipCm: 0, lengthCm: 64 },
  { id: 'l', sizeCode: 'L', chestCm: 110, waistCm: 0, hipCm: 0, lengthCm: 65 },
  { id: 'xl', sizeCode: 'XL', chestCm: 114, waistCm: 0, hipCm: 0, lengthCm: 67.1 },
];

test('measurement noise never moves the size: two captures of one person get one size', () => {
  // Live jobs f56fa1bb / 7377ef9b, same photos: chest 96.3 and 97.0 cm (was M then L).
  const first = recommendSize({ chest_cm: 96.3, waist_cm: 93.7, hip_cm: 112 }, 'tee', CREWNECK);
  const second = recommendSize({ chest_cm: 97.0, waist_cm: 92.8, hip_cm: 112 }, 'tee', CREWNECK);
  assert.equal(first.sizeCode, 'M');
  assert.equal(second.sizeCode, 'M');
  assert.equal(first.betweenSizeCode, 'L');
  assert.equal(second.betweenSizeCode, 'L');
});

test('a body clear of every boundary is not "between sizes"', () => {
  const size = recommendSize({ chest_cm: 94, waist_cm: 80, hip_cm: 96 }, 'tee', CREWNECK);
  assert.equal(size.sizeCode, 'M');
  assert.equal(size.betweenSizeCode, null);
});

test('past the tolerance the next size is chosen, and the largest size names no larger one', () => {
  assert.equal(recommendSize({ chest_cm: 98.2, waist_cm: 80, hip_cm: 96 }, 'tee', CREWNECK).sizeCode, 'L');
  const largest = recommendSize({ chest_cm: 106.5, waist_cm: 80, hip_cm: 96 }, 'tee', CREWNECK);
  assert.equal(largest.sizeCode, 'XL');
  assert.equal(largest.betweenSizeCode, null);
});
