import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { CAPTURE_OUTLINES } from '@/lib/widget/capture-outlines';
import { outlineBodyBounds, outlineFrameInView } from '@/lib/widget/outline-frame';
import {
  estimateCrownY,
  estimateSoleY,
  evaluatePoseGate,
  gateStatusCopy,
  RELAX_AFTER_MS,
  toView,
  type OutlineFrame,
  type PoseGateContext,
  type PoseLandmarkSample,
} from '@/lib/widget/pose-gates';
import {
  ALIGNED_GRACE_MS,
  INITIAL_GATE_HOLD,
  PoseSmoother,
  STATUS_SETTLE_MS,
  stepGateHold,
  type GateHoldState,
} from '@/lib/widget/pose-smoothing';
import type { PoseGateStatus } from '@/types/hmr';

type Fixture = [number, number, number[]];
const fixtures = JSON.parse(
  readFileSync(path.join(process.cwd(), 'tests/fixtures/pose-landmarks.json'), 'utf8'),
) as Record<string, Fixture>;

/** Real MediaPipe landmarks from the model photos, with that photo as the view. */
function real(key: string): { landmarks: PoseLandmarkSample[]; context: PoseGateContext } {
  const [width, height, flat] = fixtures[key];
  const landmarks = Array.from({ length: 33 }, (_, index) => ({
    x: flat[index * 3],
    y: flat[index * 3 + 1],
    visibility: flat[index * 3 + 2],
  }));
  return {
    landmarks,
    context: {
      mapping: { videoWidth: width, videoHeight: height, viewWidth: width, viewHeight: height, mirrored: false },
    },
  };
}

/** The outline drawn exactly around this body (crown, soles, torso centre). */
function ownOutline(landmarks: PoseLandmarkSample[]): OutlineFrame {
  const crown = estimateCrownY(landmarks);
  const sole = estimateSoleY(landmarks);
  assert.ok(crown !== null && sole !== null);
  return {
    top: crown,
    bottom: sole,
    centerX: (landmarks[11].x + landmarks[12].x + landmarks[23].x + landmarks[24].x) / 4,
  };
}

const SQUARE: PoseGateContext['mapping'] = {
  videoWidth: 1000,
  videoHeight: 1000,
  viewWidth: 1000,
  viewHeight: 1000,
  mirrored: false,
};
/** Crown 0.085 and soles 0.94 of the synthetic body below. */
const OUTLINE: OutlineFrame = { top: 0.085, bottom: 0.94, centerX: 0.5 };

/** A synthetic upright front A-pose, square frame, head and feet in view. */
function standing(overrides: Record<number, Partial<PoseLandmarkSample>> = {}): PoseLandmarkSample[] {
  const points: Record<number, [number, number]> = {
    0: [0.5, 0.165],
    1: [0.51, 0.15], 2: [0.515, 0.15], 3: [0.52, 0.15],
    4: [0.49, 0.15], 5: [0.485, 0.15], 6: [0.48, 0.15],
    7: [0.53, 0.155], 8: [0.47, 0.155], 9: [0.51, 0.18], 10: [0.49, 0.18],
    11: [0.6, 0.25], 12: [0.4, 0.25],
    13: [0.66, 0.38], 14: [0.34, 0.38],
    15: [0.72, 0.5], 16: [0.28, 0.5],
    17: [0.73, 0.52], 18: [0.27, 0.52], 19: [0.73, 0.52], 20: [0.27, 0.52], 21: [0.72, 0.51], 22: [0.28, 0.51],
    23: [0.56, 0.52], 24: [0.44, 0.52],
    25: [0.56, 0.72], 26: [0.44, 0.72],
    27: [0.56, 0.9], 28: [0.44, 0.9],
    29: [0.56, 0.92], 30: [0.44, 0.92],
    31: [0.57, 0.94], 32: [0.43, 0.94],
  };
  return Array.from({ length: 33 }, (_, index) => ({
    x: overrides[index]?.x ?? points[index][0],
    y: overrides[index]?.y ?? points[index][1],
    visibility: overrides[index]?.visibility ?? 1,
  }));
}

function shift(landmarks: PoseLandmarkSample[], dx: number, dy: number): PoseLandmarkSample[] {
  return landmarks.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
}

/** Scale about the synthetic body's centre (distance from the camera). */
function scale(landmarks: PoseLandmarkSample[], factor: number): PoseLandmarkSample[] {
  return landmarks.map((p) => ({ ...p, x: 0.5 + (p.x - 0.5) * factor, y: 0.5125 + (p.y - 0.5125) * factor }));
}

const front = (
  landmarks: PoseLandmarkSample[],
  extra: Partial<PoseGateContext> = {},
  previous?: PoseGateStatus,
): PoseGateStatus => evaluatePoseGate(landmarks, 'front', previous, { mapping: SQUARE, outline: OUTLINE, ...extra });

test('real model photos pass when the body fills its outline', () => {
  for (const key of ['model-front-whole', 'model-side-whole']) {
    const { landmarks, context } = real(key);
    const view = key.includes('side') ? 'side' : 'front';
    assert.equal(evaluatePoseGate(landmarks, view, undefined, { ...context, outline: ownOutline(landmarks) }), 'aligned', key);
    assert.equal(evaluatePoseGate(landmarks, view, undefined, context), 'aligned', `${key} gallery band`);
  }
});

test('the estimated crown and soles sit on the real silhouette (male mask: 0.108 / 0.955)', () => {
  const { landmarks } = real('model-front-whole');
  assert.ok(Math.abs((estimateCrownY(landmarks) ?? 0) - 0.108) < 0.02);
  assert.ok(Math.abs((estimateSoleY(landmarks) ?? 0) - 0.955) < 0.02);
});

test('a head cut off by the frame is never green, though the model still reports the eyes', () => {
  for (const key of ['model-front-headless', 'model-side-headless']) {
    const { landmarks, context } = real(key);
    const view = key.includes('side') ? 'side' : 'front';
    // The eyes are in frame with full confidence: the crown is what is missing.
    assert.ok((landmarks[2].visibility ?? 0) > 0.9 && landmarks[2].y > 0);
    assert.ok((estimateCrownY(landmarks) ?? 1) < 0);
    assert.equal(evaluatePoseGate(landmarks, view, undefined, { ...context, outline: ownOutline(landmarks) }), 'show_head', key);
    assert.notEqual(evaluatePoseGate(landmarks, view, undefined, context), 'aligned', key);
  }
  assert.match(gateStatusCopy('show_head', 'front'), /whole head/i);
});

test('feet cut off by the frame are never green', () => {
  for (const key of ['model-front-feetless', 'model-side-feetless']) {
    const { landmarks, context } = real(key);
    const view = key.includes('side') ? 'side' : 'front';
    assert.equal(evaluatePoseGate(landmarks, view, undefined, { ...context, outline: ownOutline(landmarks) }), 'not_detected', key);
    assert.notEqual(evaluatePoseGate(landmarks, view, undefined, context), 'aligned', key);
  }
});

test('green only when the body matches the drawn outline', () => {
  assert.equal(front(standing()), 'aligned');
  // A few centimetres off is still green.
  assert.equal(front(shift(standing(), 0.02, 0.02)), 'aligned');
  assert.equal(front(scale(standing(), 1.15)), 'too_close');
  assert.equal(front(scale(standing(), 0.85)), 'too_far');
  // 7% off is green since the 2026-10-11 relaxation (was 6%).
  assert.equal(front(shift(standing(), 0, -0.07)), 'aligned');
  // Right size, but the phone points too high or low.
  assert.equal(front(shift(standing(), 0, -0.12)), 'fit_outline');
  assert.equal(front(shift(standing(), 0.1, 0)), 'off_center');
  assert.match(gateStatusCopy('fit_outline', 'front'), /outline/);
});

test('a lock holds through small drift that would not start one', () => {
  const drifted = shift(standing(), 0.1, 0);
  assert.equal(front(drifted), 'off_center');
  assert.equal(front(drifted, {}, 'aligned'), 'aligned');
});

test('after a long search the gate starts at its looser hold limits, never past them', () => {
  const drifted = shift(standing(), 0.1, 0);
  assert.equal(front(drifted, { relaxed: true }), 'aligned');
  assert.equal(front(shift(standing(), 0.2, 0), { relaxed: true }), 'off_center');
  // The whole head must still be in the picture.
  assert.equal(front(shift(standing(), 0, -0.09), { relaxed: true }), 'show_head');
  assert.equal(front(scale(standing(), 1.25), { relaxed: true }), 'too_close');
  assert.ok(RELAX_AFTER_MS >= 10_000);
});

test('bending, leaning and squatting are never green', () => {
  // Bending toward the camera: shoulders drop toward the hips.
  const bending = standing({
    0: { y: 0.4 }, 1: { y: 0.39 }, 2: { y: 0.39 }, 3: { y: 0.39 }, 4: { y: 0.39 }, 5: { y: 0.39 }, 6: { y: 0.39 },
    7: { y: 0.39 }, 8: { y: 0.39 }, 9: { y: 0.41 }, 10: { y: 0.41 },
    11: { y: 0.44 }, 12: { y: 0.44 }, 15: { y: 0.7 }, 16: { y: 0.7 },
  });
  assert.equal(front(bending), 'stand_straight');

  const leaning = standing({ 11: { x: 0.74 }, 12: { x: 0.54 } });
  assert.equal(front(leaning), 'stand_straight');

  const squatting = standing({ 23: { y: 0.66 }, 24: { y: 0.66 }, 25: { x: 0.66, y: 0.74 }, 26: { x: 0.34, y: 0.74 } });
  assert.equal(front(squatting), 'stand_straight');
  assert.match(gateStatusCopy('stand_straight', 'front'), /straight/i);
});

test('moving during the hold is not green', () => {
  assert.equal(front(standing(), { motion: 0.03 }), 'hold_still');
  assert.equal(front(standing(), { motion: 0.015 }), 'hold_still');
  assert.equal(front(standing(), { motion: 0.015 }, 'aligned'), 'aligned');
  assert.equal(front(standing(), { motion: 0.002 }), 'aligned');
});

test('front arms: closed or raised are named', () => {
  assert.equal(front(standing({ 15: { x: 0.55 }, 16: { x: 0.45 } })), 'arms_closed');
  assert.equal(front(standing({ 15: { y: 0.1 }, 16: { y: 0.1 } })), 'arms_too_high');
});

test('facing: front needs square shoulders, side needs a profile', () => {
  assert.equal(front(standing({ 11: { x: 0.52 }, 12: { x: 0.48 } })), 'turn_required');
  assert.equal(evaluatePoseGate(standing(), 'side', undefined, { mapping: SQUARE, outline: OUTLINE }), 'turn_required');
});

test('side needs the wrists at or above the shoulders', () => {
  const { landmarks, context } = real('model-side-whole');
  const outline = ownOutline(landmarks);
  const dropped = landmarks.map((p, index) => (index === 15 || index === 16 ? { ...p, y: 0.5 } : p));
  assert.equal(evaluatePoseGate(dropped, 'side', undefined, { ...context, outline }), 'raise_wrists');
  assert.match(gateStatusCopy('raise_wrists', 'side'), /shoulder height/i);
});

test('missing wrists or ankles are not_detected', () => {
  assert.equal(front(standing({ 15: { visibility: 0.1 }, 16: { visibility: 0.1 } })), 'not_detected');
  assert.equal(
    front(standing({ 27: { visibility: 0.1 }, 28: { visibility: 0.1 }, 29: { visibility: 0.1 }, 30: { visibility: 0.1 }, 31: { visibility: 0.1 }, 32: { visibility: 0.1 } })),
    'not_detected',
  );
});

test('raw camera points map into the cropped, mirrored preview', () => {
  // A 3:4 frame drawn object-cover into a taller 0.6 view: the sides are cropped.
  const mapping = { videoWidth: 1440, videoHeight: 1920, viewWidth: 600, viewHeight: 1000, mirrored: true };
  const centre = toView({ x: 0.5, y: 0.5 }, mapping);
  assert.ok(Math.abs(centre.x - 0.5) < 1e-9 && Math.abs(centre.y - 0.5) < 1e-9);
  const left = toView({ x: 0.3, y: 0 }, mapping);
  // Mirrored: raw-left lands right of centre; the 0.75 frame is wider than the view.
  assert.ok(left.x > 0.5 && Math.abs(left.x - (0.5 + 0.2 * (1440 * (1000 / 1920)) / 600)) < 1e-9);
  assert.ok(Math.abs(left.y) < 1e-9);
});

test('the outline frame comes from the drawn outline itself', () => {
  const bounds = outlineBodyBounds(CAPTURE_OUTLINES.male.front);
  assert.ok(bounds.top > 0 && bounds.top < 80 && bounds.bottom > 920 && bounds.bottom <= 1000);
  // The overlay lays the SVG out at 86% height inside a 6% padded box.
  const frame = outlineFrameInView(
    bounds,
    { left: 73.6, top: 59.2, width: 552.8, height: 881.6 },
    { left: 0, top: 0, width: 700, height: 1000 },
  );
  assert.ok(frame);
  assert.ok(Math.abs(frame.centerX - 0.5) < 1e-9);
  assert.ok(frame.top > 0.059 && frame.bottom < 0.941 && frame.bottom - frame.top > 0.8);
});

function run(steps: Array<[PoseGateStatus, number]>): GateHoldState {
  return steps.reduce((state, [raw, at]) => stepGateHold(state, raw, at), INITIAL_GATE_HOLD);
}

test('a one-frame wobble does not restart the 1.2 s hold', () => {
  const held = run([['aligned', 0], ['too_far', 66], ['aligned', 132]]);
  assert.equal(held.shown, 'aligned');
  assert.equal(held.alignedSince, 0);

  const wobbling = run([['aligned', 0], ['too_far', 66], ['fit_outline', 132], ['too_far', 198]]);
  assert.equal(wobbling.shown, 'aligned');

  const left = run([['aligned', 0], ['too_far', 66], ['too_far', 66 + ALIGNED_GRACE_MS]]);
  assert.equal(left.shown, 'too_far');
  assert.equal(left.alignedSince, null);
});

test('red instructions change only once they settle', () => {
  const start = run([['too_far', 0], ['too_far', STATUS_SETTLE_MS]]);
  assert.equal(start.shown, 'too_far');
  const flicker = stepGateHold(start, 'off_center', STATUS_SETTLE_MS + 66);
  assert.equal(flicker.shown, 'too_far');
  const settled = stepGateHold(flicker, 'off_center', STATUS_SETTLE_MS * 2 + 66);
  assert.equal(settled.shown, 'off_center');
});

test('smoothing reports motion and steadies jitter', () => {
  const smoother = new PoseSmoother();
  assert.equal(smoother.push(standing()).motion, 0);
  assert.equal(smoother.push(standing()).motion, 0);
  const jittered = smoother.push(shift(standing(), 0.02, 0));
  assert.ok(jittered.motion > 0 && jittered.motion < 0.02 / 0.65);
  assert.ok(Math.abs(jittered.landmarks[11].x - 0.61) < 1e-9, 'half of a one-frame jump');
  // The jump still counts as motion while the body pauses for a moment.
  const paused = smoother.push(shift(standing(), 0.02, 0));
  assert.equal(paused.motion, jittered.motion);
});

const viewportSource = readFileSync(
  path.join(process.cwd(), 'components/widget/guided-capture/capture-viewport.tsx'),
  'utf8',
);

test('each capture is reviewed before it is used: Retake, or it continues on its own', () => {
  assert.match(viewportSource, /Use this photo/);
  assert.match(viewportSource, /Retake/);
  assert.match(viewportSource, /onCaptured\(capture\.blob, capture\.gate, capture\.photo\)/);
  // The shopper stands far from the phone: a live photo is kept after the review countdown.
  assert.match(viewportSource, /const AUTO_ACCEPT_MS = \d+/);
  assert.match(viewportSource, /autoAccept: true/);
});
