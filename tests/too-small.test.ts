import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MIN_EASE, sizeTooSmall } from '@/lib/fit/too-small';

const body = { chest_cm: 100, waist_cm: 84, hip_cm: 102 };

test('a top closes at the chest with MIN_EASE over the body', () => {
  assert.equal(MIN_EASE, 0.02);
  assert.match(sizeTooSmall('tee', { chestCm: 101 }, body, false) ?? '', /^chest 101 cm on a 100 cm body$/);
  assert.equal(sizeTooSmall('tee', { chestCm: 102 }, body, false), null);
});

test('loose sizes are never too small', () => {
  assert.equal(sizeTooSmall('tee', { chestCm: 140 }, body, false), null);
  assert.equal(sizeTooSmall('pant', { hipCm: 140, waistCm: 120 }, body, false), null);
});

test('bottoms close at the seat, and at the waist only without elastic', () => {
  assert.match(sizeTooSmall('pant', { hipCm: 100, waistCm: 100 }, body, true) ?? '', /^hip/);
  assert.equal(sizeTooSmall('pant', { hipCm: 110, waistCm: 80 }, body, true), null);
  assert.match(sizeTooSmall('pant', { hipCm: 110, waistCm: 80 }, body, false) ?? '', /^waist/);
});

test('missing girths never block a drape', () => {
  assert.equal(sizeTooSmall('tee', {}, body, false), null);
  assert.equal(sizeTooSmall('tee', { chestCm: 90 }, { ...body, chest_cm: 0 }, false), null);
});
