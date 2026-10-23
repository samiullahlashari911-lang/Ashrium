import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import sharp from 'sharp';

import { applyLightCurve, lightCurveFromGray } from '@/lib/widget/frame-light';
import { assessFrameQuality, grayscaleFromRgba } from '@/lib/widget/frame-quality';

const MODEL_PHOTO = readFileSync('public/marketing/capture-front.webp');

async function rgbaOf(input: sharp.Sharp): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  const { data, info } = await input.resize(192).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { rgba: new Uint8ClampedArray(data), width: info.width, height: info.height };
}

function meanGray(rgba: Uint8ClampedArray): number {
  const gray = grayscaleFromRgba(rgba, rgba.length / 4);
  return gray.reduce((sum, value) => sum + value, 0) / gray.length;
}

function levelled(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const curve = lightCurveFromGray(grayscaleFromRgba(rgba, rgba.length / 4));
  const out = new Uint8ClampedArray(rgba);
  if (curve) {
    applyLightCurve(out, curve);
  }
  return out;
}

test('a well-lit capture is left as it is', async () => {
  const { rgba } = await rgbaOf(sharp(MODEL_PHOTO));
  const after = levelled(rgba);
  assert.ok(Math.abs(meanGray(after) - meanGray(rgba)) < 30, 'a good photo barely changes');
});

test('a dim room is brought up to a usable capture', async () => {
  const { rgba, width, height } = await rgbaOf(sharp(MODEL_PHOTO).linear(0.18, 0));
  const before = grayscaleFromRgba(rgba, width * height);
  assert.equal(assessFrameQuality(before, width, height), 'too_dark');
  const after = levelled(rgba);
  assert.ok(meanGray(after) > 90, `mean ${meanGray(after)}`);
  assert.equal(assessFrameQuality(grayscaleFromRgba(after, width * height), width, height), 'ok');
});

test('a washed-out frame gets its contrast back', async () => {
  const { rgba } = await rgbaOf(sharp(MODEL_PHOTO).linear(0.4, 150));
  const spread = (pixels: Uint8ClampedArray): number => {
    const gray = Array.from(grayscaleFromRgba(pixels, pixels.length / 4)).sort((a, b) => a - b);
    return gray[Math.floor(gray.length * 0.95)]! - gray[Math.floor(gray.length * 0.05)]!;
  };
  assert.ok(spread(levelled(rgba)) > spread(rgba) * 1.8);
});

test('a black frame is not stretched into noise', () => {
  const curve = lightCurveFromGray(new Float32Array(1000).fill(3));
  assert.ok(curve);
  assert.ok(curve[3]! < 120, 'gain is capped');
});
