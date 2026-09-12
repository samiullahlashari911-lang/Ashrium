import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import {
  buildShopifyOAuthRedirectUrl,
  createShopifyOAuthState,
  getShopifyOAuthRedirectUri,
  normalizeShopifyShopDomain,
  parseShopifyOAuthState,
  resolveShopifyOAuthAppRedirect,
  shopifyAccessTokenNeedsRefresh,
  shopifyShopIdentityHosts,
  shopifyShopIsAuthorizedForIdentity,
  verifyShopifyCallbackHmac,
} from '@/lib/server/shopify-oauth';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const SHOP_DOMAIN = 'legendary1122.myshopify.com';

function withShopifyOAuthEnv<T>(run: () => T): T {
  const previous = {
    appBaseUrl: process.env.APP_BASE_URL,
    clientId: process.env.SHOPIFY_CLIENT_ID,
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET,
    redirectUri: process.env.SHOPIFY_OAUTH_REDIRECT_URI,
  };

  process.env.APP_BASE_URL = 'https://app.ashrium.test';
  process.env.SHOPIFY_CLIENT_ID = 'shopify-client-id';
  process.env.SHOPIFY_CLIENT_SECRET = 'shopify-client-secret';

  try {
    return run();
  } finally {
    if (previous.appBaseUrl === undefined) {
      delete process.env.APP_BASE_URL;
    } else {
      process.env.APP_BASE_URL = previous.appBaseUrl;
    }
    if (previous.clientId === undefined) {
      delete process.env.SHOPIFY_CLIENT_ID;
    } else {
      process.env.SHOPIFY_CLIENT_ID = previous.clientId;
    }
    if (previous.clientSecret === undefined) {
      delete process.env.SHOPIFY_CLIENT_SECRET;
    } else {
      process.env.SHOPIFY_CLIENT_SECRET = previous.clientSecret;
    }
    if (previous.redirectUri === undefined) {
      delete process.env.SHOPIFY_OAUTH_REDIRECT_URI;
    } else {
      process.env.SHOPIFY_OAUTH_REDIRECT_URI = previous.redirectUri;
    }
  }
}

function signCallbackQuery(
  params: Record<string, string>,
  clientSecret: string,
): URLSearchParams {
  const query = new URLSearchParams(params);
  const message = [...query.entries()]
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  query.set('hmac', createHmac('sha256', clientSecret).update(message).digest('hex'));
  return query;
}

test('normalizes Shopify shop domains', () => {
  assert.equal(normalizeShopifyShopDomain('legendary1122'), 'legendary1122.myshopify.com');
  assert.equal(
    normalizeShopifyShopDomain('https://Legendary1122.myshopify.com/admin'),
    'legendary1122.myshopify.com',
  );
  assert.equal(normalizeShopifyShopDomain('not a shop'), null);
});

test('creates and parses tenant-scoped Shopify OAuth state', () => {
  withShopifyOAuthEnv(() => {
    const state = createShopifyOAuthState({
      tenantId: TENANT_ID,
      shopDomain: SHOP_DOMAIN,
      returnTo: '/onboarding',
    });
    const claims = parseShopifyOAuthState(state);

    assert.ok(claims);
    assert.equal(claims.tenantId, TENANT_ID);
    assert.equal(claims.shopDomain, SHOP_DOMAIN);
    assert.equal(claims.returnTo, '/onboarding');
    assert.equal(parseShopifyOAuthState(`${state}x`), null);
    assert.equal(parseShopifyOAuthState('not-a-token'), null);
  });
});

test('derives the Shopify OAuth redirect URI from APP_BASE_URL', () => {
  withShopifyOAuthEnv(() => {
    assert.equal(
      getShopifyOAuthRedirectUri(),
      'https://app.ashrium.test/api/v1/shopify/oauth/callback',
    );
  });
});

test('buildShopifyOAuthRedirectUrl rejects open redirects', () => {
  assert.equal(
    buildShopifyOAuthRedirectUrl('//evil.test/phish', 'error', 'nope'),
    '/settings/integrations?shopify=error&message=nope',
  );
});

test('shopifyAccessTokenNeedsRefresh respects the refresh buffer', () => {
  const soon = new Date(Date.now() + 60_000).toISOString();
  const later = new Date(Date.now() + 10 * 60_000).toISOString();

  assert.equal(shopifyAccessTokenNeedsRefresh(soon), true);
  assert.equal(shopifyAccessTokenNeedsRefresh(later), false);
  assert.equal(shopifyAccessTokenNeedsRefresh(null), false);
});

test('verifies Shopify callback HMAC signatures', () => {
  withShopifyOAuthEnv(() => {
    const query = signCallbackQuery(
      {
        code: 'oauth-code',
        shop: SHOP_DOMAIN,
        state: 'signed-state',
        timestamp: '1750000000',
      },
      'shopify-client-secret',
    );

    assert.equal(verifyShopifyCallbackHmac(query, 'shopify-client-secret'), true);
    query.set('hmac', 'deadbeef');
    assert.equal(verifyShopifyCallbackHmac(query, 'shopify-client-secret'), false);
  });
});

test('callback validation rejects invalid OAuth state before token exchange', () => {
  withShopifyOAuthEnv(() => {
    assert.equal(parseShopifyOAuthState('invalid-state'), null);

    const query = signCallbackQuery(
      {
        code: 'oauth-code',
        shop: SHOP_DOMAIN,
        state: 'invalid-state',
        timestamp: '1750000000',
      },
      'shopify-client-secret',
    );

    assert.equal(verifyShopifyCallbackHmac(query, 'shopify-client-secret'), true);
    assert.equal(parseShopifyOAuthState(query.get('state') ?? ''), null);
    assert.equal(
      buildShopifyOAuthRedirectUrl('/settings/integrations', 'error', 'Shopify OAuth state was invalid or expired.'),
      '/settings/integrations?shopify=error&message=Shopify+OAuth+state+was+invalid+or+expired.',
    );
  });
});

test('callback validation maps Shopify OAuth errors to redirect messages', () => {
  const query = new URLSearchParams({
    error: 'access_denied',
    error_description: 'Merchant declined',
  });

  assert.equal(query.get('error'), 'access_denied');
  assert.equal(
    buildShopifyOAuthRedirectUrl('/settings/integrations', 'error', query.get('error_description') ?? 'denied'),
    '/settings/integrations?shopify=error&message=Merchant+declined',
  );
});

test('OAuth app redirects are absolute so Response.redirect does not 500', () => {
  const redirect = resolveShopifyOAuthAppRedirect(
    'https://www.ashrium.org/api/v1/shopify/oauth/start?shop=legendary1122.myshopify.com',
    '/settings/integrations',
    'error',
    'Sign in with an active merchant account before connecting Shopify.',
  );

  assert.equal(redirect.origin, 'https://www.ashrium.org');
  assert.equal(redirect.pathname, '/settings/integrations');
  assert.equal(redirect.searchParams.get('shopify'), 'error');
  const redirected = Response.redirect(redirect, 302);
  assert.equal(redirected.status, 302);
  assert.equal(redirected.headers.get('location'), redirect.toString());
});

test('Legendary storefront hostname is an alias of the permanent myshopify domain', () => {
  const identity = {
    myshopifyDomain: '2sdyw6-ki.myshopify.com',
    primaryDomainUrl: 'https://legendary1122.myshopify.com',
  };

  assert.equal(shopifyShopIsAuthorizedForIdentity('legendary1122.myshopify.com', identity), true);
  assert.equal(shopifyShopIsAuthorizedForIdentity('2sdyw6-ki.myshopify.com', identity), true);
  assert.equal(shopifyShopIsAuthorizedForIdentity('other-shop.myshopify.com', identity), false);
  assert.deepEqual(shopifyShopIdentityHosts(identity).sort(), [
    '2sdyw6-ki.myshopify.com',
    'legendary1122.myshopify.com',
  ]);
});
