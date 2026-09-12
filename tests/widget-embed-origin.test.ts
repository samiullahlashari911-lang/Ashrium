import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isWidgetEmbedParentAuthorized } from '@/lib/widget/embed-origin';
import {
  shopIdentityStorefrontOrigins,
  trustedStorefrontOrigins,
} from '@/lib/server/storefront-allowlist';

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

test('OAuth shop and primary domain are both trusted widget parents', () => {
  const identity = shopIdentityStorefrontOrigins({
    myshopifyDomain: '2sdyw6-ki.myshopify.com',
    primaryDomainUrl: 'https://legendary1122.myshopify.com',
  });
  assert.ok(identity.includes('https://2sdyw6-ki.myshopify.com'));
  assert.ok(identity.includes('https://legendary1122.myshopify.com'));

  const trusted = trustedStorefrontOrigins({
    allowedDomains: ['https://2sdyw6-ki.myshopify.com'],
    merchantDomain: '2sdyw6-ki.myshopify.com',
    shopifyShopDomain: 'legendary1122.myshopify.com',
  });
  assert.ok(trusted.includes('https://2sdyw6-ki.myshopify.com'));
  assert.ok(trusted.includes('https://legendary1122.myshopify.com'));
  assert.equal(
    isWidgetEmbedParentAuthorized({
      isDevelopment: false,
      parentOrigin: 'https://legendary1122.myshopify.com',
      referrerOrigin: 'https://legendary1122.myshopify.com',
      appOrigin: APP,
      trustedOrigins: trusted,
    }),
    true,
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
