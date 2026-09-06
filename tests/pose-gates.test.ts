import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluatePoseGate, gateStatusCopy, type PoseLandmarkSample } from '@/lib/widget/pose-gates';

function landmarks(overrides: Record<number, Partial<PoseLandmarkSample>>): PoseLandmarkSample[] {
  const points: PoseLandmarkSample[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 1,
  }));

  Object.entries(overrides).forEach(([index, sample]) => {
    points[Number(index)] = {
      x: sample.x ?? 0.5,
      y: sample.y ?? 0.5,
      visibility: sample.visibility ?? 1,
    };
  });

  return points;
}

const FRONT_ALIGNED = landmarks({
  11: { x: 0.38, y: 0.28 },
  12: { x: 0.62, y: 0.28 },
  15: { x: 0.28, y: 0.48 },
  16: { x: 0.72, y: 0.48 },
  23: { x: 0.42, y: 0.52 },
  24: { x: 0.58, y: 0.52 },
  27: { x: 0.43, y: 0.88 },
  28: { x: 0.57, y: 0.88 },
});

const SIDE_ALIGNED = landmarks({
  11: { x: 0.49, y: 0.28 },
  12: { x: 0.51, y: 0.28 },
  15: { x: 0.49, y: 0.22 },
  16: { x: 0.51, y: 0.22 },
  23: { x: 0.49, y: 0.52 },
  24: { x: 0.51, y: 0.52 },
  27: { x: 0.49, y: 0.88 },
  28: { x: 0.51, y: 0.88 },
});

test('front A-pose is aligned when the body fills the silhouette', () => {
  assert.equal(evaluatePoseGate(FRONT_ALIGNED, 'front'), 'aligned');
  assert.equal(gateStatusCopy('aligned', 'front'), 'Hold still');
});

test('side profile is aligned when shoulders are stacked', () => {
  assert.equal(evaluatePoseGate(SIDE_ALIGNED, 'side'), 'aligned');
  assert.equal(gateStatusCopy('turn_required', 'side'), 'Turn to your side');
});

test('missing landmarks are not_detected', () => {
  const hiddenWrists = landmarks({
    11: { x: 0.38, y: 0.28 },
    12: { x: 0.62, y: 0.28 },
    15: { x: 0.28, y: 0.48, visibility: 0.1 },
    16: { x: 0.72, y: 0.48, visibility: 0.1 },
    23: { x: 0.42, y: 0.52 },
    24: { x: 0.58, y: 0.52 },
    27: { x: 0.43, y: 0.88 },
    28: { x: 0.57, y: 0.88 },
  });

  assert.equal(evaluatePoseGate(hiddenWrists, 'front'), 'not_detected');
});

test('too close when the body exceeds the frame', () => {
  const close = landmarks({
    11: { x: 0.38, y: 0.01 },
    12: { x: 0.62, y: 0.01 },
    15: { x: 0.28, y: 0.4 },
    16: { x: 0.72, y: 0.4 },
    23: { x: 0.42, y: 0.5 },
    24: { x: 0.58, y: 0.5 },
    27: { x: 0.43, y: 0.98 },
    28: { x: 0.57, y: 0.98 },
  });

  assert.equal(evaluatePoseGate(close, 'front'), 'too_close');
});

test('too far when the body is small in frame', () => {
  const far = landmarks({
    11: { x: 0.44, y: 0.4 },
    12: { x: 0.56, y: 0.4 },
    15: { x: 0.38, y: 0.5 },
    16: { x: 0.62, y: 0.5 },
    23: { x: 0.46, y: 0.55 },
    24: { x: 0.54, y: 0.55 },
    27: { x: 0.47, y: 0.7 },
    28: { x: 0.53, y: 0.7 },
  });

  assert.equal(evaluatePoseGate(far, 'front'), 'too_far');
});

test('front turn_required when shoulders are too narrow', () => {
  const turned = landmarks({
    11: { x: 0.48, y: 0.28 },
    12: { x: 0.52, y: 0.28 },
    15: { x: 0.28, y: 0.48 },
    16: { x: 0.72, y: 0.48 },
    23: { x: 0.42, y: 0.52 },
    24: { x: 0.58, y: 0.52 },
    27: { x: 0.43, y: 0.88 },
    28: { x: 0.57, y: 0.88 },
  });

  assert.equal(evaluatePoseGate(turned, 'front'), 'turn_required');
});

test('side turn_required when the shopper still faces the camera', () => {
  assert.equal(evaluatePoseGate(FRONT_ALIGNED, 'side'), 'turn_required');
});

test('side raise_wrists when wrists hang below the shoulders', () => {
  const dropped = landmarks({
    11: { x: 0.49, y: 0.28 },
    12: { x: 0.51, y: 0.28 },
    15: { x: 0.49, y: 0.48 },
    16: { x: 0.51, y: 0.48 },
    23: { x: 0.49, y: 0.52 },
    24: { x: 0.51, y: 0.52 },
    27: { x: 0.49, y: 0.88 },
    28: { x: 0.51, y: 0.88 },
  });

  assert.equal(evaluatePoseGate(dropped, 'side'), 'raise_wrists');
  assert.equal(gateStatusCopy('raise_wrists', 'side'), 'Raise your wrists to your shoulders');
});

test('side is aligned when wrists sit at the shoulders', () => {
  const atShoulders = landmarks({
    11: { x: 0.49, y: 0.28 },
    12: { x: 0.51, y: 0.28 },
    15: { x: 0.49, y: 0.28 },
    16: { x: 0.51, y: 0.28 },
    23: { x: 0.49, y: 0.52 },
    24: { x: 0.51, y: 0.52 },
    27: { x: 0.49, y: 0.88 },
    28: { x: 0.51, y: 0.88 },
  });

  assert.equal(evaluatePoseGate(atShoulders, 'side'), 'aligned');
});

test('side is aligned when only the near wrist is visible and raised', () => {
  const nearOnly = landmarks({
    11: { x: 0.49, y: 0.28 },
    12: { x: 0.51, y: 0.28 },
    15: { x: 0.50, y: 0.22 },
    16: { x: 0.51, y: 0.48, visibility: 0.1 },
    23: { x: 0.49, y: 0.52 },
    24: { x: 0.51, y: 0.52 },
    27: { x: 0.49, y: 0.88 },
    28: { x: 0.51, y: 0.88 },
  });

  assert.equal(evaluatePoseGate(nearOnly, 'side'), 'aligned');
});

