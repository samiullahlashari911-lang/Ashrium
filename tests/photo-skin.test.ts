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
  hairTopFromPixels,
  findHeadAnchors,
  fitSimilarity2D,
  frameUvForView,
  type PhotoFrameMeta,
} from '@/lib/graphics/photo-skin';
import { MHR_VERTEX_COUNT, type MhrPhotoUv } from '@/types/hmr';

/** MHR mean body, metres, from the shipped hull. */
function restTriangles(): Uint32Array {
  const glb = readFileSync('public/models/mhr-hull.glb');
  const jsonLength = glb.readUInt32LE(12);
  const start = 20 + jsonLength + 8 + MHR_VERTEX_COUNT * 12;
  const bytes = glb.subarray(start, start + 110622 * 4);
  return new Uint32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

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

test('unseen vertices take their nearest seen neighbour: no buttons on the back, no face on the back of the head', () => {
  const { positions, frame, photoUv, anchors } = scene();
  // The front photo sees the front half, the side photo the shopper's left side.
  const front = Array.from({ length: MHR_VERTEX_COUNT }, (_, i) => (positions[i * 3 + 2]! > 0.02 ? 200 : 0));
  const side = Array.from({ length: MHR_VERTEX_COUNT }, (_, i) => (positions[i * 3]! > 0.05 ? 200 : 0));
  const uv: MhrPhotoUv = { front_uv: photoUv, front_weight: front, side_uv: photoUv, side_weight: side };
  const attributes = buildPhotoSkinAttributes(positions, uv, frame, frame, restTriangles());

  const seenUv = new Map<string, number>();
  for (let i = 0; i < MHR_VERTEX_COUNT; i += 1) {
    if (front[i]! + side[i]! > 0) seenUv.set(`${attributes.uvFront[i * 2]},${attributes.uvFront[i * 2 + 1]}`, i);
  }
  let backOfHead = 0;
  for (let i = 0; i < MHR_VERTEX_COUNT; i += 1) {
    assert.ok(attributes.weights[i * 2]! + attributes.weights[i * 2 + 1]! > 0, `vertex ${i} has a source`);
    if (front[i]! + side[i]! > 0) continue;
    const from = seenUv.get(`${attributes.uvFront[i * 2]},${attributes.uvFront[i * 2 + 1]}`);
    assert.ok(from !== undefined, 'copied from a seen vertex');
    const isBackOfHead = positions[i * 3 + 1]! > anchors.noseY && positions[i * 3 + 2]! < -0.03;
    if (isBackOfHead) {
      backOfHead += 1;
      // The source is head/hair at the side or top, never the face at the front.
      assert.ok(positions[from! * 3 + 2]! < 0.06, 'back of head never takes the face');
    }
  }
  assert.ok(backOfHead > 20);
});

test('hair top is found against a plain wall, and the head is stretched to reach it', () => {
  const width = 200;
  const height = 120;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const hair = y >= 30 && x >= 80 && x <= 120;
      rgba.set(hair ? [40, 30, 25, 255] : [235, 228, 220, 255], i);
    }
  }
  assert.equal(hairTopFromPixels(rgba, width, height, 100, 20, 110), 30);
  const blank = new Uint8ClampedArray(width * height * 4).fill(230);
  assert.equal(hairTopFromPixels(blank, width, height, 100, 20, 110), null);

  const { positions, frame, photoUv, anchors } = scene();
  const plain = new Float32Array(MHR_VERTEX_COUNT * 2);
  frameUvForView(photoUv, frame, positions, anchors, plain);
  let crown = 0;
  for (let i = 1; i < MHR_VERTEX_COUNT; i += 1) {
    if (positions[i * 3 + 1]! > positions[crown * 3 + 1]!) crown = i;
  }
  const hairTopY = plain[crown * 2 + 1]! - 0.012;
  const stretched = new Float32Array(MHR_VERTEX_COUNT * 2);
  frameUvForView(photoUv, { ...frame, hairTopY }, positions, anchors, stretched);
  assert.ok(Math.abs(stretched[crown * 2 + 1]! - hairTopY) < 1e-6, 'crown reaches the hair top');
  assert.ok(Math.abs(stretched[anchors.leftEye * 2 + 1]! - plain[anchors.leftEye * 2 + 1]!) < 1e-9, 'eyes stay put');
  const wild = new Float32Array(MHR_VERTEX_COUNT * 2);
  frameUvForView(photoUv, { ...frame, hairTopY: 0 }, positions, anchors, wild);
  assert.equal(wild[crown * 2 + 1], plain[crown * 2 + 1], 'an absurd hair top is ignored');
});

test('head edges that land on the wall are refilled from the head, never painted wall-coloured', () => {
  const { positions, frame, photoUv, anchors } = scene();
  const rows = Math.floor(frame.keepBox.y);
  const rgba = new Uint8ClampedArray(WIDTH * rows * 4);
  const [noseX, noseY] = truePx(positions, anchors.nose);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      // The real head is a little narrower than the fitted one: its outer ring is wall.
      const onHead = Math.hypot((x - noseX) / 82, (y - (noseY - 20)) / 150) < 1;
      rgba.set(onHead ? [70, 50, 40, 255] : [236, 230, 222, 255], (y * WIDTH + x) * 4);
    }
  }
  const head = { rgba, width: WIDTH, height: rows, background: [236, 230, 222] as [number, number, number] };
  // Facing weight like the GPU's: face-on high, the outline low.
  const seen = Array.from({ length: MHR_VERTEX_COUNT }, (_, i) => {
    const z = positions[i * 3 + 2]!;
    return z > 0 ? Math.max(1, Math.min(255, Math.round(z * 2000))) : 0;
  });
  const uv: MhrPhotoUv = { front_uv: photoUv, front_weight: seen, side_uv: photoUv, side_weight: seen.map(() => 0) };
  const attributes = buildPhotoSkinAttributes(positions, uv, { ...frame, head }, null, restTriangles());
  // Face-on vertices are never tested against the wall, even if skin is wall-pale.
  const pale = new Uint8ClampedArray(rgba).fill(0);
  for (let k = 0; k < pale.length; k += 4) pale.set([236, 230, 222, 255], k);
  const paleFace = buildPhotoSkinAttributes(positions, uv, { ...frame, head: { ...head, rgba: pale } }, null, restTriangles());
  assert.ok(paleFace.weights[anchors.nose * 2]! > 0.5, 'the nose keeps its own photo even on a pale wall');
  let checked = 0;
  for (let i = 0; i < MHR_VERTEX_COUNT; i += 1) {
    const x = Math.floor(attributes.uvFront[i * 2]! * WIDTH);
    const y = Math.floor((1 - attributes.uvFront[i * 2 + 1]!) * HEIGHT);
    if (y < 0 || y >= rows || x < 0 || x >= WIDTH) continue;
    const k = (y * WIDTH + x) * 4;
    assert.notDeepEqual([rgba[k], rgba[k + 1], rgba[k + 2]], [236, 230, 222], `head vertex ${i} shows the wall`);
    checked += 1;
  }
  assert.ok(checked > 1000);
});
