import assert from 'node:assert/strict';
import { test } from 'node:test';

import { merchantPasswordProblem } from '@/lib/auth/password-policy';
import {
  buildAuthConfirmUrl,
  inviteEmail,
  isMerchantAuthLinkType,
  passwordResetEmail,
} from '@/lib/server/auth-links';

test('merchant passwords need 12+ characters, matching, at most 72 bytes', () => {
  assert.match(merchantPasswordProblem('short', 'short') ?? '', /at least 12/);
  assert.match(merchantPasswordProblem('a'.repeat(73), 'a'.repeat(73)) ?? '', /at most 72/);
  assert.match(merchantPasswordProblem(' '.repeat(12), ' '.repeat(12)) ?? '', /spaces/);
  assert.match(merchantPasswordProblem('linen shirts fit', 'linen shirts fat') ?? '', /do not match/);
  assert.equal(merchantPasswordProblem('linen shirts fit', 'linen shirts fit'), null);
});

test('account links open our confirm page with the hashed token', () => {
  const url = new URL(buildAuthConfirmUrl('https://www.ashrium.org', 'invite', 'abc123def456'));
  assert.equal(url.origin, 'https://www.ashrium.org');
  assert.equal(url.pathname, '/auth/confirm');
  assert.equal(url.searchParams.get('type'), 'invite');
  assert.equal(url.searchParams.get('token_hash'), 'abc123def456');
  assert.equal(isMerchantAuthLinkType('recovery'), true);
  assert.equal(isMerchantAuthLinkType('magiclink'), false);
});

test('account emails escape the company name and carry the link', () => {
  const link = 'https://www.ashrium.org/auth/confirm?type=invite&token_hash=abc';
  const email = inviteEmail('<script>alert(1)</script> & Co', link);
  assert.ok(!email.html.includes('<script>'));
  assert.ok(email.html.includes('&lt;script&gt;'));
  assert.ok(email.html.includes('type=invite&amp;token_hash=abc'));
  assert.ok(email.text.includes(link));

  const reset = passwordResetEmail(link);
  assert.match(reset.subject, /Reset/);
  assert.ok(reset.text.includes('1 hour'));
});
