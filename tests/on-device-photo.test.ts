import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PoseLandmarkSample } from '@/lib/widget/pose-gates';
import {
  captureOnDevicePhoto,
  headlessKeepBox,
  headlessUvToFrameUv,
  releaseOnDevicePhoto,
} from '@/lib/widget/webp-encode';

interface FakeCanvas {
  width: number;
  height: number;
  drawn: number;
  getContext: () => { drawImage: () => void };
}

function withFakeCanvas<T>(run: (made: FakeCanvas[]) => T): T {
  const made: FakeCanvas[] = [];
  const previous = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    createElement: (tag: string) => {
      assert.equal(tag, 'canvas');
      const canvas: FakeCanvas = {
        width: 0,
        height: 0,
        drawn: 0,
        getContext: () => ({ drawImage: () => { canvas.drawn += 1; } }),
      };
      made.push(canvas);
      return canvas;
    },
  };
  try {
    return run(made);
  } finally {
    (globalThis as { document?: unknown }).document = previous;
  }
}

const POSE: PoseLandmarkSample[] = Array.from({ length: 33 }, (_, index) => {
  if (index <= 10) {
    return { x: 0.45 + index * 0.01, y: index >= 9 ? 0.2 : 0.14, visibility: 1 };
  }
  return { x: 0.5, y: 0.6, visibility: 1 };
});

test('on-device photo keeps the full frame as a canvas, never a Blob', () => {
  withFakeCanvas((made) => {
    const photo = captureOnDevicePhoto({} as CanvasImageSource, POSE, 1080, 1920);
    assert.ok(photo);
    assert.equal(made.length, 1);
    assert.equal(photo.frame, made[0] as unknown as HTMLCanvasElement);
    assert.equal(made[0]?.drawn, 1);
    assert.ok(!(photo.frame instanceof Blob));
    assert.deepEqual([photo.frame.width, photo.frame.height], [1080, 1920]);
    assert.equal(photo.landmarks.length, 33);

    const box = headlessKeepBox(POSE, 1080, 1920);
    assert.deepEqual(photo.keepBox, box, 'same box the upload was cropped to');
  });
});

test('large frames are scaled, and the head-crop box with them', () => {
  withFakeCanvas(() => {
    const photo = captureOnDevicePhoto({} as CanvasImageSource, POSE, 2160, 3840);
    assert.ok(photo);
    assert.equal(photo.frame.height, 1920);
    const box = headlessKeepBox(POSE, 2160, 3840);
    assert.ok(box);
    assert.equal(photo.keepBox.y, box.y / 2);
    assert.equal(photo.keepBox.height, box.height / 2);
  });
});

test('no photo when the head crop cannot be proven (fail closed like the upload)', () => {
  withFakeCanvas((made) => {
    const faceless = POSE.map((landmark, index) => (index <= 10 ? { ...landmark, visibility: 0 } : landmark));
    assert.equal(captureOnDevicePhoto({} as CanvasImageSource, faceless, 1080, 1920), null);
    assert.equal(made.length, 0);
  });
});

test('GPU photo_uv maps back into the full frame; v < 0 lands on the head', () => {
  const keepBox = { x: 0, y: 480, width: 1080, height: 1440 };
  const [u, v] = headlessUvToFrameUv(0.5, 0, keepBox, 1080, 1920);
  assert.equal(u, 0.5);
  assert.equal(v, 0.25, 'top of the upload is the crop line');
  const [, bottom] = headlessUvToFrameUv(0.5, 1, keepBox, 1080, 1920);
  assert.equal(bottom, 1);
  const [, head] = headlessUvToFrameUv(0.5, -0.1, keepBox, 1080, 1920);
  assert.ok(head < 0.25 && head > 0, 'above the crop, inside the frame');
});

test('release wipes the pixels at once', () => {
  withFakeCanvas(() => {
    const photo = captureOnDevicePhoto({} as CanvasImageSource, POSE, 1080, 1920);
    assert.ok(photo);
    releaseOnDevicePhoto(photo);
    assert.deepEqual([photo.frame.width, photo.frame.height], [0, 0]);
    releaseOnDevicePhoto(null);
  });
});
