import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isSafeAppPath } from '@/lib/safe-path';
import { sheetSafeText } from '@/lib/server/google-sheet-lead';
import { buildShopifyOAuthRedirectUrl } from '@/lib/server/shopify-oauth';

const BACKSLASH = String.fromCharCode(92);

test('safe app paths stay on this origin', () => {
  assert.equal(isSafeAppPath('/settings/integrations'), true);
  assert.equal(isSafeAppPath('/dashboard?tab=garments'), true);
  assert.equal(isSafeAppPath('//evil.example'), false);
  assert.equal(isSafeAppPath(`/${BACKSLASH}evil.example`), false);
  assert.equal(isSafeAppPath('/\tevil.example'), false);
  assert.equal(isSafeAppPath('https://evil.example'), false);
  assert.equal(isSafeAppPath('settings'), false);
});

test('Shopify OAuth return paths cannot leave the app', () => {
  const redirect = buildShopifyOAuthRedirectUrl(`/${BACKSLASH}evil.example`, 'error');
  assert.equal(new URL(redirect, 'https://www.ashrium.org').host, 'www.ashrium.org');
});

test('lead fields cannot run as spreadsheet formulas', () => {
  assert.equal(sheetSafeText('=IMPORTXML("https://evil.example","//a")'), `'=IMPORTXML("https://evil.example","//a")`);
  assert.equal(sheetSafeText('+1 555'), "'+1 555");
  assert.equal(sheetSafeText('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(sheetSafeText('Acme Apparel'), 'Acme Apparel');
  assert.equal(sheetSafeText('https://acme.myshopify.com'), 'https://acme.myshopify.com');
});
