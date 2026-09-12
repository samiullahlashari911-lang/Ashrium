import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  CONSENT_GUIDANCE_ID,
  consentContinueGuidance,
  isConsentContinueEnabled,
} from '@/lib/widget/consent-gate';
import { VFR_WIDGET_SCRIPT_SRC } from '@/lib/widget/embed-origin';

const widgetSource = readFileSync(path.join(process.cwd(), 'public/vfr-widget.js'), 'utf8');
const intakeSource = readFileSync(
  path.join(process.cwd(), 'components/widget/guided-capture/capture-intake.tsx'),
  'utf8',
);
const gallerySource = readFileSync(
  path.join(process.cwd(), 'components/widget/guided-capture/debug-gallery-upload.tsx'),
  'utf8',
);

test('embedded widget iframe does not set sandbox, so Chrome cannot block consent Next', () => {
  assert.doesNotMatch(widgetSource, /\.sandbox\s*=/);
  assert.doesNotMatch(widgetSource, /setAttribute\('sandbox'/);
  assert.match(widgetSource, /frame\.src = buildFrameUrl/);
});

test('consent Next stays gated until both 16+ and privacy are checked', () => {
  assert.equal(isConsentContinueEnabled({ ageAttested: false, privacyConsent: false }), false);
  assert.equal(isConsentContinueEnabled({ ageAttested: true, privacyConsent: false }), false);
  assert.equal(isConsentContinueEnabled({ ageAttested: false, privacyConsent: true }), false);
  assert.equal(isConsentContinueEnabled({ ageAttested: true, privacyConsent: true }), true);
});

test('consent guidance names the missing 16+ or privacy check, then the ready state', () => {
  assert.equal(
    consentContinueGuidance({ ageAttested: false, privacyConsent: false }).message,
    'Check both boxes above — age 16+ and privacy consent — to enable Next.',
  );
  assert.match(
    consentContinueGuidance({ ageAttested: false, privacyConsent: true }).message,
    /16 or older/,
  );
  assert.match(
    consentContinueGuidance({ ageAttested: true, privacyConsent: false }).message,
    /privacy notice/,
  );

  const ready = consentContinueGuidance({ ageAttested: true, privacyConsent: true });
  assert.equal(ready.ready, true);
  assert.equal(ready.id, CONSENT_GUIDANCE_ID);
  assert.match(ready.message, /camera stays off/i);
});

test('intake and gallery do not use a <form> that Chrome can block in an iframe', () => {
  assert.doesNotMatch(intakeSource, /<form/);
  assert.doesNotMatch(gallerySource, /<form/);
  assert.match(intakeSource, /onClick=\{advance\}/);
  assert.match(intakeSource, /type="button"/);
  assert.doesNotMatch(intakeSource, /type="submit"/);
  assert.match(intakeSource, /isConsentContinueEnabled/);
  assert.match(intakeSource, /setPage\('height'\)/);
  assert.match(intakeSource, /HeightDial/);
  assert.doesNotMatch(intakeSource, /grid-cols-3/);
});

test('sandbox host cache-busts vfr-widget.js when the embed script changes', () => {
  assert.match(VFR_WIDGET_SCRIPT_SRC, /^\/vfr-widget\.js\?v=/);
  assert.match(VFR_WIDGET_SCRIPT_SRC, /no-sandbox/);
  assert.match(widgetSource, /launcher-1/);
});
