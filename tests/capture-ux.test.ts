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

test('capture flow reports completed steps on each screen', () => {
  assert.equal(captureFlowProgress('consent').statusLine, '0 of 5 steps complete · Consent');
  assert.equal(captureFlowProgress('height').completed, 1);
  assert.equal(captureFlowProgress('profile').current, 3);
  assert.match(captureFlowProgress('front').statusLine, /3 of 5 steps complete/);
  assert.match(captureFlowProgress('side').statusLine, /4 of 5 steps complete/);
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

test('intake uses a height dial with Next on the right and vertical sex options', () => {
  assert.match(intakeSource, /HeightDial/);
  assert.match(intakeSource, /NextCircleButton/);
  assert.match(intakeSource, /setPage\('profile'\)/);
  assert.doesNotMatch(intakeSource, /grid-cols-3/);
  assert.match(intakeSource, /flex min-w-0 flex-1 flex-col gap-2/);
  assert.match(intakeSource, /Weight <span className="font-normal text-obsidian-subtle">optional/);
  assert.match(intakeSource, /CaptureFlowMeter/);
});

test('live capture passes the last gate into pose evaluation and tints the outline', () => {
  assert.match(viewportSource, /evaluatePoseGate\(pose, view, lastGateRef\.current\)/);
  assert.match(viewportSource, /<SilhouetteOverlay view=\{view\} gate=\{gate\} \/>/);
  assert.match(overlaySource, /gate = 'not_detected'/);
  assert.match(overlaySource, /strokeDasharray/);
});
