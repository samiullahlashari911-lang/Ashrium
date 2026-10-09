import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import sharp from 'sharp';

import { assessFrameQuality, grayscaleFromRgba } from '@/lib/widget/frame-quality';

async function grayOf(input: sharp.Sharp): Promise<{ gray: Float32Array; width: number; height: number }> {
  const { data, info } = await input.resize(192).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { gray: grayscaleFromRgba(data, info.width * info.height), width: info.width, height: info.height };
}

const MODEL_PHOTO = readFileSync('public/marketing/capture-front.webp');

test('a normal capture passes (real full-body photo on a plain wall)', async () => {
  const { gray, width, height } = await grayOf(sharp(MODEL_PHOTO));
  assert.equal(assessFrameQuality(gray, width, height), 'ok');
});

test('a dark room is refused with a reason', async () => {
  const { gray, width, height } = await grayOf(sharp(MODEL_PHOTO).linear(0.15, 0));
  assert.equal(assessFrameQuality(gray, width, height), 'too_dark');
});

test('a heavily blurred capture is refused, a slightly soft one is not', async () => {
  const blurred = await grayOf(sharp(MODEL_PHOTO).blur(12));
  assert.equal(assessFrameQuality(blurred.gray, blurred.width, blurred.height), 'blurry');
  const soft = await grayOf(sharp(MODEL_PHOTO).blur(1));
  assert.equal(assessFrameQuality(soft.gray, soft.width, soft.height), 'ok');
});
