import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  evaluateStorefrontGoLive,
  STOREFRONT_APP_EMBED_INSTRUCTIONS,
} from '@/lib/onboarding';
import {
  MISSING_INVITE_LINK_MESSAGE,
  readOperatorInviteLink,
} from '@/lib/server/provision-merchant';

const root = process.cwd();

function readSource(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

test('storefront go-live stays incomplete until Shopify, allowlist, shop origin, and a garment exist', () => {
  const incomplete = evaluateStorefrontGoLive({
    allowedDomains: [],
    garmentCount: 0,
    platformUrl: 'https://www.ashrium.org',
    shopDomain: null,
    shopifyConnected: false,
  });

  assert.equal(incomplete.ready, false);
  assert.equal(incomplete.widgetAvailableUrl, 'https://www.ashrium.org/api/v1/widget/available');
  assert.equal(incomplete.embedInstructions, STOREFRONT_APP_EMBED_INSTRUCTIONS);

  const shopOnly = evaluateStorefrontGoLive({
    allowedDomains: ['https://brand.myshopify.com'],
    garmentCount: 1,
    platformUrl: 'https://www.ashrium.org/',
    shopDomain: 'brand.myshopify.com',
    shopifyConnected: true,
  });
  assert.equal(shopOnly.ready, true);
  assert.equal(shopOnly.items.find((item) => item.id === 'custom-origin')?.complete, false);
  assert.equal(shopOnly.items.find((item) => item.id === 'custom-origin')?.required, false);

  const missingShopOrigin = evaluateStorefrontGoLive({
    allowedDomains: ['https://www.brand.com'],
    garmentCount: 1,
    platformUrl: 'https://www.ashrium.org',
    shopDomain: 'brand.myshopify.com',
    shopifyConnected: true,
  });
  assert.equal(missingShopOrigin.ready, false);
  assert.equal(missingShopOrigin.items.find((item) => item.id === 'shop-origin')?.complete, false);

  const full = evaluateStorefrontGoLive({
    allowedDomains: ['https://brand.myshopify.com', 'https://www.brand.com'],
    garmentCount: 2,
    platformUrl: 'https://www.ashrium.org',
    shopDomain: 'brand.myshopify.com',
    shopifyConnected: true,
  });
  assert.equal(full.ready, true);
  assert.equal(full.items.find((item) => item.id === 'custom-origin')?.complete, true);
});

test('operator invite payloads without an http invite link are rejected', () => {
  assert.equal(
    readOperatorInviteLink({
      tenantId: 't',
      userId: 'u',
      inviteLink: 'https://example.supabase.co/auth/v1/verify?token=abc',
    }),
    'https://example.supabase.co/auth/v1/verify?token=abc',
  );
  assert.equal(readOperatorInviteLink({ tenantId: 't', userId: 'u', inviteLink: null }), null);
  assert.equal(readOperatorInviteLink({ inviteLink: '' }), null);
  assert.ok(MISSING_INVITE_LINK_MESSAGE.includes('Do not email the merchant'));
});

test('onboarding and sandbox copy point at App embeds and refuse sandbox-as-golive', () => {
  const wizard = readSource('app/(dashboard)/onboarding/onboarding-wizard.tsx');
  const banner = readSource('components/dashboard/storefront-golive-banner.tsx');
  const sandbox = readSource('app/(dashboard)/sandbox/storefront-sandbox.tsx');
  const layout = readSource('app/(dashboard)/layout.tsx');
  const invite = readSource('scripts/invite-merchant.mjs');
  const inviteLocal = readSource('scripts/invite-merchant-local.mjs');
  const middleware = readSource('middleware.ts');

  assert.match(wizard, /App embeds/);
  assert.match(wizard, /Ashrium Try On/);
  assert.match(wizard, /not live storefront Try On/);
  assert.doesNotMatch(wizard, /Add the "Virtual fitting room" app block to your product template/);

  assert.match(banner, /Storefront is not live/);
  assert.match(banner, /not storefront go-live/);
  assert.match(layout, /StorefrontGoLiveBanner/);
  assert.match(sandbox, /not storefront go-live/);

  assert.match(invite, /no invite link was returned/);
  assert.match(invite, /process\.exit\(1\)/);
  assert.match(inviteLocal, /no invite link was returned/);
  assert.match(inviteLocal, /process\.exit\(1\)/);
  assert.doesNotMatch(inviteLocal, /process\.exit\(0\)/);

  assert.match(middleware, /resolveApiCorsOrigin/);
});
