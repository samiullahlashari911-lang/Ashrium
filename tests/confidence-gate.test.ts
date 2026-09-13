import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  evaluateConfidenceGate,
  ingestAllowsHighConfidence,
  residualWithinTolerance,
} from '@/lib/fit/confidence-gate';
import { recommendFit } from '@/lib/fit/recommend';
import { recommendSize } from '@/lib/fit/size-recommend';

const MEASUREMENTS = { chest_cm: 100, waist_cm: 82, hip_cm: 100 };

test('ingest allows high confidence for Tier 1 and validated Tier 2 only', () => {
  assert.equal(ingestAllowsHighConfidence(1, true), true);
  assert.equal(ingestAllowsHighConfidence(2, false), true);
  assert.equal(ingestAllowsHighConfidence(2, true), false);
  assert.equal(ingestAllowsHighConfidence(null, false), false);
});

test('confidence AND-gate requires capture, ingest, and drape', () => {
  const passing = evaluateConfidenceGate({
    captureGatesPassed: true,
    ingestTier: 1,
    approximateFit: false,
    hnswSimilarity: 0.996,
    xpbdCompleted: false,
  });
  assert.equal(passing.highConfidence, true);
  assert.equal(passing.residualPassed, true);

  const captureFail = evaluateConfidenceGate({
    captureGatesPassed: false,
    ingestTier: 1,
    approximateFit: false,
    hnswSimilarity: 0.996,
    xpbdCompleted: false,
  });
  assert.equal(captureFail.highConfidence, false);

  const ingestFail = evaluateConfidenceGate({
    captureGatesPassed: true,
    ingestTier: 2,
    approximateFit: true,
    hnswSimilarity: 0.996,
    xpbdCompleted: false,
  });
  assert.equal(ingestFail.highConfidence, false);

  const drapeFail = evaluateConfidenceGate({
    captureGatesPassed: true,
    ingestTier: 1,
    approximateFit: false,
    hnswSimilarity: 0.99,
    xpbdCompleted: false,
  });
  assert.equal(drapeFail.highConfidence, false);
  assert.equal(drapeFail.drapePassed, false);

  const xpbdPass = evaluateConfidenceGate({
    captureGatesPassed: true,
    ingestTier: 1,
    approximateFit: false,
    hnswSimilarity: null,
    xpbdCompleted: true,
  });
  assert.equal(xpbdPass.highConfidence, true);
  assert.equal(xpbdPass.drapePassed, true);
});

test('size recommendation maps tee girths plus ease onto the letter chart', () => {
  const size = recommendSize(MEASUREMENTS, 'tee', []);
  assert.equal(size.source, 'ease_chart');
  assert.equal(size.sizeCode, 'L');
});

test('numeric AU sizes sort in size order even when chest is unpublished', () => {
  const size = recommendSize(MEASUREMENTS, 'pant', [
    { id: 'a', sizeCode: '10', chestCm: 0, waistCm: 70, hipCm: 96, lengthCm: 90 },
    { id: 'b', sizeCode: '4', chestCm: 0, waistCm: 62, hipCm: 88, lengthCm: 88 },
    { id: 'c', sizeCode: '6', chestCm: 0, waistCm: 66, hipCm: 92, lengthCm: 89 },
  ]);
  assert.equal(size.sizeCode, '10');
});

test('5XL ranks after XL on the letter chart', () => {
  const size = recommendSize(
    { chest_cm: 140, waist_cm: 120, hip_cm: 140 },
    'tee',
    [
      { id: 's', sizeCode: 'S', chestCm: 96, waistCm: 80, hipCm: 96, lengthCm: 68 },
      { id: 'xl', sizeCode: 'XL', chestCm: 120, waistCm: 104, hipCm: 120, lengthCm: 74 },
      { id: '5xl', sizeCode: '5XL', chestCm: 144, waistCm: 128, hipCm: 144, lengthCm: 80 },
    ],
  );
  assert.equal(size.sizeCode, '5XL');
});

test('recommendFit never emits high confidence without the full gate', () => {
  const result = recommendFit({
    measurements: MEASUREMENTS,
    category: 'tee',
    variants: [],
    captureGatesPassed: true,
    ingestTier: null,
    approximateFit: true,
  });

  assert.equal(result.gate.highConfidence, false);
  assert.equal(result.size.sizeCode, 'L');
});

test('large height or clothing residual forces Approximate and keeps the girth size', () => {
  assert.equal(residualWithinTolerance(0.4, 0.12), true);
  assert.equal(residualWithinTolerance(4, 0.3), true);
  assert.equal(residualWithinTolerance(4.1, 0.12), false);
  assert.equal(residualWithinTolerance(0.4, 0.31), false);
  assert.equal(residualWithinTolerance(null, null), true);

  const heightFail = evaluateConfidenceGate({
    captureGatesPassed: true,
    ingestTier: 1,
    approximateFit: false,
    hnswSimilarity: 0.996,
    xpbdCompleted: false,
    heightResidualCm: 5,
    clothingResidual: 0.1,
  });
  assert.equal(heightFail.residualPassed, false);
  assert.equal(heightFail.highConfidence, false);

  const clothingFail = evaluateConfidenceGate({
    captureGatesPassed: true,
    ingestTier: 1,
    approximateFit: false,
    hnswSimilarity: null,
    xpbdCompleted: true,
    heightResidualCm: 0.2,
    clothingResidual: 0.5,
  });
  assert.equal(clothingFail.residualPassed, false);
  assert.equal(clothingFail.highConfidence, false);

  const result = recommendFit({
    measurements: MEASUREMENTS,
    category: 'tee',
    variants: [],
    captureGatesPassed: true,
    ingestTier: 1,
    approximateFit: false,
    xpbdCompleted: true,
    heightResidualCm: 8,
    clothingResidual: 0.1,
  });
  assert.equal(result.gate.highConfidence, false);
  assert.equal(result.gate.residualPassed, false);
  assert.equal(result.size.sizeCode, 'L');
});

test('a completed Newton drape satisfies the AND-gate with no client time cutoff', () => {
  const waiting = evaluateConfidenceGate({
    captureGatesPassed: true,
    ingestTier: 1,
    approximateFit: false,
    hnswSimilarity: null,
    xpbdCompleted: false,
  });
  assert.equal(waiting.drapePassed, false);
  assert.equal(waiting.highConfidence, false);

  const landed = evaluateConfidenceGate({
    captureGatesPassed: true,
    ingestTier: 1,
    approximateFit: false,
    hnswSimilarity: null,
    xpbdCompleted: true,
  });
  assert.equal(landed.drapePassed, true);
  assert.equal(landed.highConfidence, true);
  assert.equal(landed.printPassed, true);
});

test('print QA failure is part of the AND-gate even for Tier 1', () => {
  const failed = evaluateConfidenceGate({
    captureGatesPassed: true,
    ingestTier: 1,
    approximateFit: false,
    hnswSimilarity: null,
    xpbdCompleted: true,
    printQaPassed: false,
  });
  assert.equal(failed.printPassed, false);
  assert.equal(failed.highConfidence, false);
});
