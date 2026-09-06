import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isBiometricAssetPath,
  parseBiometricJobImagePath,
} from '@/lib/server/biometrics-wipe';
import { isValidAnnyFitDispatch, parseAnnyFitDispatchRequest } from '@/lib/server/hmr-request';
import { isFitJobId, parseRecommendRequest, parseResolveRequest } from '@/lib/server/fit-request';
import { authorizeCronRequest, cronSecretMatches, readCronSecret } from '@/lib/server/cron-secret';
import {
  checkRateLimit,
  evaluateRateLimitWindow,
  resetRateLimitWindowsForTests,
} from '@/lib/server/rate-limit';
import { normalizeOrigin } from '@/lib/server/request-origin';

const TENANT = '550e8400-e29b-41d4-a716-446655440000';
const JOB = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';

test('biometric paths accept only tenant/job/front|side.webp', () => {
  const front = `${TENANT}/${JOB}/front.webp`;
  const side = `${TENANT}/${JOB}/side.webp`;

  assert.equal(isBiometricAssetPath(front), true);
  assert.equal(isBiometricAssetPath(side), true);
  assert.equal(isBiometricAssetPath(`${TENANT}/${JOB}/front.jpg`), false);
  assert.deepEqual(parseBiometricJobImagePath(front), {
    tenantId: TENANT,
    jobId: JOB,
    view: 'front',
  });
});

test('HMR dispatch parser rejects incomplete or out-of-range payloads', () => {
  assert.equal(parseAnnyFitDispatchRequest(null), null);
  assert.equal(parseAnnyFitDispatchRequest({ frontImagePath: 'x' }), null);

  const parsed = parseAnnyFitDispatchRequest({
    frontImagePath: `${TENANT}/${JOB}/front.webp`,
    sideImagePath: `${TENANT}/${JOB}/side.webp`,
    heightCm: 176,
    sex: 'female',
    weightKg: 68,
  });
  assert.ok(parsed);
  assert.equal(isValidAnnyFitDispatch(parsed), true);

  const tooTall = parseAnnyFitDispatchRequest({
    frontImagePath: `${TENANT}/${JOB}/front.webp`,
    sideImagePath: `${TENANT}/${JOB}/side.webp`,
    heightCm: 300,
    sex: 'male',
  });
  assert.ok(tooTall);
  assert.equal(isValidAnnyFitDispatch(tooTall), false);
});

test('fit recommend and resolve parsers require a UUID job id', () => {
  assert.equal(isFitJobId('not-a-uuid'), false);
  assert.equal(parseRecommendRequest({ jobId: JOB, sku: 'TEE-1', captureGatesPassed: true })?.sku, 'TEE-1');
  assert.equal(parseRecommendRequest({ jobId: JOB, sku: 'TEE-1', captureGatesPassed: 'yes' }), null);
  assert.equal(parseResolveRequest({ jobId: JOB, sku: 'TEE-1', allowXpbd: false })?.allowXpbd, false);
  assert.equal(parseResolveRequest({ jobId: JOB, sku: 'TEE-1', allowXpbd: 'true' }), null);
});

test('in-memory rate limit denies the request after the window fills', () => {
  resetRateLimitWindowsForTests();
  const first = checkRateLimit('test:a', 2, 60_000);
  const second = checkRateLimit('test:a', 2, 60_000);
  const third = checkRateLimit('test:a', 2, 60_000);

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal(third.remaining, 0);
});

test('evaluateRateLimitWindow drops timestamps outside the window', () => {
  const now = 10_000;
  const evaluated = evaluateRateLimitWindow({
    timestamps: [1000, 2000, 9500],
    now,
    limit: 2,
    windowMs: 1000,
  });

  assert.equal(evaluated.result.allowed, true);
  assert.equal(evaluated.timestamps.length, 2);
});

test('cron bearer comparison is length-safe', () => {
  assert.equal(cronSecretMatches('abcdefghijklmnop', 'abcdefghijklmnop'), true);
  assert.equal(cronSecretMatches('short', 'abcdefghijklmnop'), false);
});

test('authorizeCronRequest returns 503 when CRON_SECRET is unset', () => {
  const previous = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;

  const response = authorizeCronRequest(new Request('http://localhost/api/v1/cron/ttl-sweep'));
  assert.ok(response);
  assert.equal(response.status, 503);

  if (previous === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = previous;
  }

  assert.equal(readCronSecret() === null || (readCronSecret()?.length ?? 0) >= 16, true);
});

test('authorizeCronRequest returns 401 for a wrong bearer', () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'cron-secret-value-ok';

  const response = authorizeCronRequest(
    new Request('http://localhost/api/v1/cron/ttl-sweep', {
      headers: { authorization: 'Bearer wrong-secret-value' },
    }),
  );
  assert.ok(response);
  assert.equal(response.status, 401);

  if (previous === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = previous;
  }
});

test('normalizeOrigin rejects opaque origins', () => {
  assert.equal(normalizeOrigin('https://shop.example'), 'https://shop.example');
  assert.equal(normalizeOrigin('null'), null);
  assert.equal(normalizeOrigin('not a url'), null);
});
