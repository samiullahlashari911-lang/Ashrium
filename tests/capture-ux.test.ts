import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { captureFlowProgress } from '@/lib/widget/capture-progress';
import {
  HEIGHT_CM_DEFAULT,
  cmToFeetInches,
  feetInchesToCm,
  formatHeight,
  heightDialValues,
} from '@/lib/widget/height-units';
import {
  WEIGHT_KG_DEFAULT,
  formatWeight,
  lbToKg,
  weightWheelValues,
} from '@/lib/widget/weight-units';

const intakeSource = readFileSync(
  path.join(process.cwd(), 'components/widget/guided-capture/capture-intake.tsx'),
  'utf8',
);
const viewportSource = readFileSync(
  path.join(process.cwd(), 'components/widget/guided-capture/capture-viewport.tsx'),
  'utf8',
);
const overlaySource = readFileSync(
  path.join(process.cwd(), 'components/widget/guided-capture/silhouette-overlay.tsx'),
  'utf8',
);

test('progress line counts five steps after consent and fills on each Next', () => {
  assert.equal(captureFlowProgress('consent').current, 0);
  assert.equal(captureFlowProgress('consent').fraction, 0);
  assert.equal(captureFlowProgress('height').statusLine, 'Step 1 of 5 · Height');
  assert.equal(captureFlowProgress('sex').current, 2);
  assert.equal(captureFlowProgress('weight').current, 3);
  assert.match(captureFlowProgress('front').statusLine, /Step 4 of 5/);
  assert.equal(captureFlowProgress('side').fraction, 1);
});

test('height dial covers centimetres and feet-inches around the default', () => {
  assert.equal(HEIGHT_CM_DEFAULT, 170);
  assert.equal(formatHeight(170, 'cm'), '170 cm');
  assert.equal(formatHeight(170, 'ft_in'), '5′ 7″');
  assert.deepEqual(cmToFeetInches(170), { feet: 5, inches: 7 });
  assert.equal(feetInchesToCm(5, 7), 170);
  assert.ok(heightDialValues('cm').includes(170));
  assert.ok(heightDialValues('ft_in').includes(170));
});

test('intake walks consent, height wheel, body profile, optional weight wheel', () => {
  assert.match(intakeSource, /HeightDial/);
  assert.match(intakeSource, /WeightDial/);
  assert.match(intakeSource, /setPage\('sex'\)/);
  assert.match(intakeSource, /setPage\('weight'\)/);
  assert.match(intakeSource, /Prefer not to say/);
  assert.match(intakeSource, /Why we ask/);
  assert.match(intakeSource, /finish\(false\)/, 'weight can be skipped');
  assert.match(intakeSource, /CaptureFlowMeter/);
  assert.match(intakeSource, /onConsentPassed/);
});

test('weight wheel stores kilograms for both units', () => {
  assert.equal(formatWeight(70, 'kg'), '70 kg');
  assert.equal(formatWeight(70, 'lb'), '154 lb');
  assert.equal(lbToKg(154), 69.9);
  assert.ok(weightWheelValues('kg').includes(WEIGHT_KG_DEFAULT));
  assert.equal(new Set(weightWheelValues('lb')).size, weightWheelValues('lb').length);
});

test('live capture passes the last gate into pose evaluation and tints the outline', () => {
  assert.match(viewportSource, /evaluatePoseGate\(pose, view, lastGateRef\.current\)/);
  assert.match(viewportSource, /<SilhouetteOverlay\s+view=\{view\}\s+sex=\{sex\}\s+gate=\{gate\}\s+holdProgress=\{holdProgress\}/);
  // Side guide follows the way the shopper faces; the preview is a mirror.
  assert.match(viewportSource, /mirrored=\{view === 'side' && sideGuideMirrored\}/);
  assert.match(viewportSource, /-scale-x-100/);
  assert.match(overlaySource, /gate = 'not_detected'/);
  assert.match(overlaySource, /CAPTURE_OUTLINES\[sex\]\[view\]/);
  assert.match(overlaySource, /strokeDashoffset/);
});
