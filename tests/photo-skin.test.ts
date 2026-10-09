import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  POSE_LEFT_EAR,
  POSE_LEFT_EYE,
  POSE_MOUTH_LEFT,
  POSE_MOUTH_RIGHT,
  POSE_NOSE,
  POSE_RIGHT_EAR,
  POSE_RIGHT_EYE,
  buildPhotoSkinAttributes,
  findHeadAnchors,
  fitSimilarity2D,
  frameUvForView,
  type PhotoFrameMeta,
} from '@/lib/graphics/photo-skin';
import { MHR_VERTEX_COUNT, type MhrPhotoUv } from '@/types/hmr';

/** MHR mean body, metres, from the shipped hull. */
function restPositions(): Float32Array {
  const glb = readFileSync('public/models/mhr-hull.glb');
  const jsonLength = glb.readUInt32LE(12);
  const start = 20 + jsonLength + 8;
  const bytes = glb.subarray(start, start + MHR_VERTEX_COUNT * 12);
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

const WIDTH = 1080;
const HEIGHT = 1920;
const PX_PER_M = 1000;

/** Where the camera really saw each vertex (front, orthographic for the test). */
function truePx(positions: Float32Array, i: number): [number, number] {
  return [WIDTH / 2 + positions[i * 3]! * PX_PER_M, 1850 - positions[i * 3 + 1]! * PX_PER_M];
}

interface Scene {
  positions: Float32Array;
  frame: PhotoFrameMeta;
  photoUv: number[];
  anchors: NonNullable<ReturnType<typeof findHeadAnchors>>;
}

/**
 * The GPU never sees the head: its head projection is the true one turned
 * 12°, scaled 8 % and shifted, blending in from the neck. The body is exact.
 */
function scene(): Scene {
  const positions = restPositions();
  const anchors = findHeadAnchors(positions);
  assert.ok(anchors, 'anchors found on the MHR mean head');
  const [, noseYpx] = truePx(positions, anchors.nose);
  const keepBox = { x: 0, y: noseYpx + 90, width: WIDTH, height: HEIGHT - (noseYpx + 90) };
  const frame: PhotoFrameMeta = {
    keepBox,
    width: WIDTH,
    height: HEIGHT,
    landmarks: Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 })),
  };
  const landmark = (index: number, vertex: number): void => {
    const [x, y] = truePx(positions, vertex);
    frame.landmarks[index] = { x: x / WIDTH, y: y / HEIGHT, visibility: 0.99 };
  };
  landmark(POSE_NOSE, anchors.nose);
  landmark(POSE_LEFT_EYE, anchors.leftEye);
  landmark(POSE_RIGHT_EYE, anchors.rightEye);
  landmark(POSE_MOUTH_LEFT, anchors.mouthLeft);
  landmark(POSE_MOUTH_RIGHT, anchors.mouthRight);
  landmark(POSE_LEFT_EAR, anchors.leftEar);
  landmark(POSE_RIGHT_EAR, anchors.rightEar);

  const angle = (12 * Math.PI) / 180;
  const [pivotX, pivotY] = truePx(positions, anchors.nose);
  const photoUv: number[] = [];
  for (let i = 0; i < MHR_VERTEX_COUNT; i += 1) {
    let [x, y] = truePx(positions, i);
    const lift = Math.min(1, Math.max(0, (positions[i * 3 + 1]! - (anchors.noseY - 0.11)) / 0.06));
    if (lift > 0) {
      const dx = (x - pivotX) * 1.08;
      const dy = (y - pivotY) * 1.08;
      const gx = pivotX + 14 + dx * Math.cos(angle) - dy * Math.sin(angle);
      const gy = pivotY - 9 + dx * Math.sin(angle) + dy * Math.cos(angle);
      x += (gx - x) * lift;
      y += (gy - y) * lift;
    }
    photoUv.push((x - keepBox.x) / keepBox.width, (y - keepBox.y) / keepBox.height);
  }
  return { positions, frame, photoUv, anchors };
}

function errorPx(out: Float32Array, positions: Float32Array, vertex: number): number {
  const [x, y] = truePx(positions, vertex);
  return Math.hypot(out[vertex * 2]! * WIDTH - x, out[vertex * 2 + 1]! * HEIGHT - y);
}

test('head anchors sit where a face is on the MHR mean body', () => {
  const positions = restPositions();
  const anchors = findHeadAnchors(positions);
  assert.ok(anchors);
  const y = (i: number): number => positions[i * 3 + 1]!;
  const x = (i: number): number => positions[i * 3]!;
  assert.ok(y(anchors.leftEye) > y(anchors.nose) && y(anchors.mouthLeft) < y(anchors.nose));
  assert.ok(x(anchors.leftEye) > 0 && x(anchors.rightEye) < 0, 'shopper left is +x');
  assert.ok(x(anchors.leftEar) > x(anchors.leftEye) && x(anchors.rightEar) < x(anchors.rightEye));
  assert.ok(anchors.noseY > 1.5 && anchors.noseY < 1.65);
});

test('similarity fit recovers a known rotation, scale and shift', () => {
  const source: Array<[number, number]> = [[0, 0], [10, 0], [0, 20], [7, 3]];
  const c = Math.cos(0.3) * 1.2;
  const s = Math.sin(0.3) * 1.2;
  const target = source.map(([x, y]) => [c * x - s * y + 5, s * x + c * y - 2] as [number, number]);
  const fit = fitSimilarity2D(source, target);
  assert.ok(fit);
  assert.ok(Math.abs(fit.a - c) < 1e-9 && Math.abs(fit.b - s) < 1e-9);
  assert.ok(Math.abs(fit.tx - 5) < 1e-9 && Math.abs(fit.ty + 2) < 1e-9);
});

test('face snaps onto the photo: upright, uncut, aligned to the landmarks', () => {
  const { positions, frame, photoUv, anchors } = scene();
  const faceHeightPx = Math.abs(frame.landmarks[POSE_MOUTH_LEFT]!.y - frame.landmarks[POSE_LEFT_EYE]!.y) * HEIGHT;

  const raw = new Float32Array(MHR_VERTEX_COUNT * 2);
  frameUvForView(photoUv, frame, positions, null, raw);
  assert.ok(errorPx(raw, positions, anchors.leftEye) / faceHeightPx > 0.3, 'GPU head guess is visibly off');

  const out = new Float32Array(MHR_VERTEX_COUNT * 2);
  const report = frameUvForView(photoUv, frame, positions, anchors, out);
  assert.ok(report);
  assert.equal(report.used, 7);
  for (const vertex of [anchors.nose, anchors.leftEye, anchors.rightEye, anchors.mouthLeft, anchors.mouthRight]) {
    assert.ok(errorPx(out, positions, vertex) / faceHeightPx <= 0.02, `anchor ${vertex} within 2 % of face height`);
  }
  const eyeAngle = Math.atan2(
    (out[anchors.leftEye * 2 + 1]! - out[anchors.rightEye * 2 + 1]!) * HEIGHT,
    (out[anchors.leftEye * 2]! - out[anchors.rightEye * 2]!) * WIDTH,
  );
  assert.ok(Math.abs((eyeAngle * 180) / Math.PI) <= 3, 'eye line level');

  // Crown and hair: every head vertex lands on its true spot (not cut off).
  let worst = 0;
  for (let i = 0; i < MHR_VERTEX_COUNT; i += 1) {
    if (positions[i * 3 + 1]! > anchors.noseY - 0.04) {
      worst = Math.max(worst, errorPx(out, positions, i) / faceHeightPx);
    }
  }
  assert.ok(worst <= 0.05, `head (crown included) within 5 % of face height, worst ${worst.toFixed(3)}`);

  // Below the neck nothing moves.
  for (let i = 0; i < MHR_VERTEX_COUNT; i += 1) {
    if (positions[i * 3 + 1]! < anchors.noseY - 0.12) {
      assert.equal(out[i * 2], raw[i * 2]);
      assert.equal(out[i * 2 + 1], raw[i * 2 + 1]);
    }
  }
});

test('too few visible landmarks keep the GPU guess (no wild fit)', () => {
  const { positions, frame, photoUv, anchors } = scene();
  frame.landmarks = frame.landmarks.map((landmark, index) => (
    index === POSE_NOSE ? landmark : { ...landmark, visibility: 0 }
  ));
  const out = new Float32Array(MHR_VERTEX_COUNT * 2);
  assert.equal(frameUvForView(photoUv, frame, positions, anchors, out), null);
});

test('every vertex gets a colour source; the unseen back of the head uses the side photo', () => {
  const { positions, frame, photoUv } = scene();
  const weightsFront = Array.from({ length: MHR_VERTEX_COUNT }, (_, i) => (positions[i * 3 + 2]! > 0 ? 200 : 0));
  // The side photo sees the shopper's left side.
  const weightsSide = Array.from({ length: MHR_VERTEX_COUNT }, (_, i) => (positions[i * 3]! > 0.01 ? 200 : 0));
  const uv: MhrPhotoUv = {
    front_uv: photoUv,
    front_weight: weightsFront,
    side_uv: photoUv,
    side_weight: weightsSide,
  };
  const attributes = buildPhotoSkinAttributes(positions, uv, frame, frame);
  let headBack = 0;
  for (let i = 0; i < MHR_VERTEX_COUNT; i += 1) {
    const wf = attributes.weights[i * 2]!;
    const ws = attributes.weights[i * 2 + 1]!;
    assert.ok(wf + ws > 0, `vertex ${i} has a source`);
    if (weightsFront[i] === 0 && weightsSide[i] === 0 && photoUv[i * 2 + 1]! < 0) {
      assert.ok(ws > 0 && wf === 0, 'back of head from the side photo');
      headBack += 1;
    }
  }
  assert.ok(headBack > 100);
  assert.ok(attributes.front && attributes.side);
  assert.ok(attributes.side.used < attributes.front.used, 'profile uses only the near-side points');
});

test('without a side photo the back of the head takes the crown hair, never the face', () => {
  const { positions, frame, photoUv } = scene();
  const frontSeen = Array.from({ length: MHR_VERTEX_COUNT }, (_, i) => (positions[i * 3 + 2]! > 0 ? 200 : 0));
  const uv: MhrPhotoUv = {
    front_uv: photoUv,
    front_weight: frontSeen,
    side_uv: photoUv,
    side_weight: Array.from({ length: MHR_VERTEX_COUNT }, () => 0),
  };
  const attributes = buildPhotoSkinAttributes(positions, uv, frame, null);
  let crown = 0;
  for (let i = 1; i < MHR_VERTEX_COUNT; i += 1) {
    if (positions[i * 3 + 1]! > positions[crown * 3 + 1]!) crown = i;
  }
  let checked = 0;
  for (let i = 0; i < MHR_VERTEX_COUNT; i += 1) {
    if (frontSeen[i] === 0 && photoUv[i * 2 + 1]! < 0) {
      assert.equal(attributes.uvFront[i * 2], attributes.uvFront[crown * 2]);
      assert.equal(attributes.uvFront[i * 2 + 1], attributes.uvFront[crown * 2 + 1]);
      checked += 1;
    }
  }
  assert.ok(checked > 100);
});
