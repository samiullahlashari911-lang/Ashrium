import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isPublicAlbedoUrl } from '@/lib/catalog/print-qa';
import {
  garmentCodeUvsFromPositions,
  sealMannequinHead,
} from '@/lib/graphics/anny-garment';
import {
  albedoHexToRgbInteger,
  evaluatePrintQaFromBytes,
  evaluatePrintQaFromImage,
  failedPrintQa,
} from '@/lib/graphics/print-qa';
import { evaluateConfidenceGate } from '@/lib/fit/confidence-gate';
import { recommendFit } from '@/lib/fit/recommend';

function pngIhdr(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function fillRgba(
  width: number,
  height: number,
  red: number,
  green: number,
  blue: number,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = 255;
  }
  return pixels;
}

test('print QA rejects missing, tiny, and undecodable images', () => {
  assert.equal(evaluatePrintQaFromBytes(new Uint8Array(8)).passed, false);
  assert.equal(evaluatePrintQaFromBytes(pngIhdr(32, 32)).reason, 'too_small');
  const ok = evaluatePrintQaFromBytes(pngIhdr(256, 256));
  assert.equal(ok.passed, true);
  assert.equal(ok.mode, 'texture');
  assert.equal(ok.width, 256);
});

test('print QA extracts fabric color and rejects skin-only photos', () => {
  const navy = evaluatePrintQaFromImage({
    width: 256,
    height: 256,
    pixels: fillRgba(64, 64, 32, 64, 160),
  });
  assert.equal(navy.passed, true);
  assert.equal(navy.mode, 'texture');
  assert.ok(navy.albedoHex);
  assert.equal(albedoHexToRgbInteger(navy.albedoHex ?? ''), 0x2040a0);

  const face = evaluatePrintQaFromImage({
    width: 256,
    height: 256,
    pixels: fillRgba(64, 64, 190, 140, 110),
  });
  assert.equal(face.passed, false);
  assert.equal(face.reason, 'no_fabric_color');
});

test('on-model photos with a fabric region pass as solid albedo, not a wrapped face', () => {
  const pixels = fillRgba(64, 64, 190, 140, 110);
  for (let index = 0; index < 64 * 16; index += 1) {
    const offset = index * 4;
    pixels[offset] = 24;
    pixels[offset + 1] = 72;
    pixels[offset + 2] = 48;
  }

  const result = evaluatePrintQaFromImage({ width: 256, height: 256, pixels });
  assert.equal(result.passed, true);
  assert.equal(result.mode, 'color');
  assert.ok(result.albedoHex);
});

test('public albedo URLs must be https and non-private', () => {
  assert.equal(isPublicAlbedoUrl('https://cdn.shopify.com/s/files/tee.jpg'), true);
  assert.equal(isPublicAlbedoUrl('http://cdn.shopify.com/s/files/tee.jpg'), false);
  assert.equal(isPublicAlbedoUrl('https://127.0.0.1/tee.jpg'), false);
  assert.equal(isPublicAlbedoUrl('https://192.168.1.9/tee.jpg'), false);
  assert.equal(failedPrintQa('missing_url').passed, false);
});

test('GarmentCode UVs wrap around the cylinder and increase with height', () => {
  const positions = new Float32Array([
    0, 0, 1,
    1, 0.5, 0,
    0, 1, -1,
  ]);
  const uvs = garmentCodeUvsFromPositions(positions);
  assert.equal(uvs.length, 6);
  assert.ok(uvs[0] >= 0 && uvs[0] < 1);
  assert.equal(uvs[1], 0);
  assert.equal(uvs[5], 1);
});

test('faceless mannequin collapses head vertices into a featureless cap', () => {
  const positions = new Float32Array([
    0.08, 0.4, 0.08,
    0.08, 1.6, 0.2,
    -0.08, 1.65, 0.18,
  ]);
  sealMannequinHead(positions);
  assert.ok(positions[4] < 1.6);
  assert.ok(Math.hypot(positions[3], positions[5]) < 0.2);
});

test('failed print QA forces Approximate and keeps the girth size', () => {
  const gate = evaluateConfidenceGate({
    captureGatesPassed: true,
    ingestTier: 1,
    approximateFit: false,
    hnswSimilarity: null,
    xpbdCompleted: true,
    printQaPassed: false,
  });
  assert.equal(gate.printPassed, false);
  assert.equal(gate.highConfidence, false);

  const result = recommendFit({
    measurements: { chest_cm: 100, waist_cm: 82, hip_cm: 100 },
    category: 'tee',
    variants: [],
    captureGatesPassed: true,
    ingestTier: 1,
    approximateFit: false,
    xpbdCompleted: true,
    printQaPassed: false,
  });
  assert.equal(result.gate.highConfidence, false);
  assert.equal(result.gate.printPassed, false);
  assert.equal(result.size.sizeCode, 'L');
});
