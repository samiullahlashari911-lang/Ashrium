import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateConfidenceGate, ingestAllowsHighConfidence } from '@/lib/fit/confidence-gate';
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
