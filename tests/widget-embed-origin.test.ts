import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isWidgetEmbedParentAuthorized } from '@/lib/widget/embed-origin';

const APP = 'https://www.ashrium.org';
const SHOP = 'https://brand.myshopify.com';

test('HTTPS dashboard sandbox is authorized as first-party even when the shop allowlist is empty', () => {
  assert.equal(
    isWidgetEmbedParentAuthorized({
      isDevelopment: false,
      parentOrigin: APP,
      referrerOrigin: APP,
      appOrigin: APP,
      trustedOrigins: [],
    }),
    true,
  );
});

test('production storefront embeds still require the merchant allowlist', () => {
  assert.equal(
    isWidgetEmbedParentAuthorized({
      isDevelopment: false,
      parentOrigin: SHOP,
      referrerOrigin: SHOP,
      appOrigin: APP,
      trustedOrigins: [SHOP],
    }),
    true,
  );
  assert.equal(
    isWidgetEmbedParentAuthorized({
      isDevelopment: false,
      parentOrigin: SHOP,
      referrerOrigin: SHOP,
      appOrigin: APP,
      trustedOrigins: [],
    }),
    false,
  );
});

test('local development still skips the production origin gate', () => {
  assert.equal(
    isWidgetEmbedParentAuthorized({
      isDevelopment: true,
      parentOrigin: 'http://localhost:3000',
      referrerOrigin: 'http://localhost:3000',
      appOrigin: 'https://localhost:3000',
      trustedOrigins: [],
    }),
    true,
  );
});
