import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PoseLandmarkSample } from '@/lib/widget/pose-gates';
import { FACE_LANDMARK_INDICES, headlessKeepBox } from '@/lib/widget/webp-encode';

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

const BODY_WITH_FACE = landmarks({
  0: { x: 0.5, y: 0.16 },
  1: { x: 0.47, y: 0.14 },
  2: { x: 0.45, y: 0.14 },
  3: { x: 0.43, y: 0.14 },
  4: { x: 0.53, y: 0.14 },
  5: { x: 0.55, y: 0.14 },
  6: { x: 0.57, y: 0.14 },
  7: { x: 0.4, y: 0.15 },
  8: { x: 0.6, y: 0.15 },
  9: { x: 0.47, y: 0.2 },
  10: { x: 0.53, y: 0.2 },
  11: { x: 0.38, y: 0.32 },
  12: { x: 0.62, y: 0.32 },
  23: { x: 0.42, y: 0.52 },
  24: { x: 0.58, y: 0.52 },
  27: { x: 0.43, y: 0.88 },
  28: { x: 0.57, y: 0.88 },
});

test('headless keep box sits strictly below every visible face landmark', () => {
  const width = 1024;
  const height = 1024;
  const box = headlessKeepBox(BODY_WITH_FACE, width, height);
  assert.ok(box);
  assert.equal(box.x, 0);
  assert.equal(box.width, width);
  assert.ok(box.y > 0);
  assert.ok(box.height === height - box.y);

  for (const index of FACE_LANDMARK_INDICES) {
    const landmark = BODY_WITH_FACE[index];
    const faceY = landmark.y * height;
    assert.ok(
      faceY < box.y,
      `face landmark ${index} at y=${faceY} must sit above keep box y=${box.y}`,
    );
  }
});

test('headless keep box fails closed when face landmarks are missing', () => {
  const hiddenFace = landmarks({
    0: { x: 0.5, y: 0.16, visibility: 0.1 },
    1: { x: 0.47, y: 0.14, visibility: 0.1 },
    2: { x: 0.45, y: 0.14, visibility: 0.1 },
    3: { x: 0.43, y: 0.14, visibility: 0.1 },
    4: { x: 0.53, y: 0.14, visibility: 0.1 },
    5: { x: 0.55, y: 0.14, visibility: 0.1 },
    6: { x: 0.57, y: 0.14, visibility: 0.1 },
    7: { x: 0.4, y: 0.15, visibility: 0.1 },
    8: { x: 0.6, y: 0.15, visibility: 0.1 },
    9: { x: 0.47, y: 0.2, visibility: 0.1 },
    10: { x: 0.53, y: 0.2, visibility: 0.1 },
    11: { x: 0.38, y: 0.32 },
    12: { x: 0.62, y: 0.32 },
  });

  assert.equal(headlessKeepBox(hiddenFace, 1024, 1024), null);
  assert.equal(headlessKeepBox(BODY_WITH_FACE, 0, 1024), null);
});
