import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  AGE_ATTESTATION_LABEL,
  CONSENT_CHECKBOX_LABEL,
  CONSENT_SUMMARY,
  FITTED_CLOTHING_COPY,
  PRIVACY_SECTIONS,
  UNDER_16_REFUSAL,
} from '@/lib/privacy/consent-copy';
import {
  ILLINOIS_BIPA_GEOFENCE_ENABLED,
  isLikelyIllinoisLocale,
  shouldBlockIllinoisCapture,
} from '@/lib/privacy/illinois-bipa';

const privacyPage = readFileSync(path.join(process.cwd(), 'app/privacy/page.tsx'), 'utf8');
const intake = readFileSync(
  path.join(process.cwd(), 'components/widget/guided-capture/capture-intake.tsx'),
  'utf8',
);

test('checkbox copy names the photos, on-device head crop, and 15-minute wipe', () => {
  assert.match(CONSENT_CHECKBOX_LABEL, /two photos of my body/i);
  assert.match(CONSENT_CHECKBOX_LABEL, /head is cropped on this device/i);
  assert.match(CONSENT_CHECKBOX_LABEL, /height, sex, and optional weight/i);
  assert.match(CONSENT_SUMMARY, /Face pixels never leave this device/i);
  assert.match(CONSENT_SUMMARY, /15 minutes/);
});

test('privacy page renders the same checkbox, age, and fitted-clothing strings', () => {
  assert.match(privacyPage, /CONSENT_CHECKBOX_LABEL/);
  assert.match(privacyPage, /CONSENT_SUMMARY/);
  assert.match(privacyPage, /AGE_ATTESTATION_LABEL/);
  assert.match(privacyPage, /UNDER_16_REFUSAL/);
  assert.match(privacyPage, /FITTED_CLOTHING_COPY/);
  assert.match(intake, /CONSENT_CHECKBOX_LABEL/);
  assert.match(intake, /AGE_ATTESTATION_LABEL/);
  assert.match(intake, /FITTED_CLOTHING_COPY/);
  assert.match(intake, /UNDER_16_REFUSAL/);
});

test('privacy sections cover head crop, 16+, fitted clothing, and the 15-minute TTL', () => {
  const body = PRIVACY_SECTIONS.map((section) => section.body).join('\n');
  assert.match(body, /cropped on-device/i);
  assert.match(body, /15-minute/);
  assert.match(body, /16 or older/);
  assert.match(body, /fitted clothing/i);
  assert.match(body, /COPPA/);
  assert.match(AGE_ATTESTATION_LABEL, /16 years of age or older/);
  assert.match(UNDER_16_REFUSAL, /under 16/);
  assert.match(FITTED_CLOTHING_COPY, /silhouette must not become the body/i);
});

test('Illinois BIPA geofence ship flag stays off and does not block capture', () => {
  assert.equal(ILLINOIS_BIPA_GEOFENCE_ENABLED, false);
  assert.equal(shouldBlockIllinoisCapture({ timeZone: 'America/Chicago' }), false);
  assert.equal(isLikelyIllinoisLocale({ timeZone: 'America/Chicago' }), true);
  assert.equal(isLikelyIllinoisLocale({ timeZone: 'America/New_York' }), false);
  assert.equal(isLikelyIllinoisLocale({ timeZone: 'UTC', language: 'en-US-u-rg-usil' }), true);
});
