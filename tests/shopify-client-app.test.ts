import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import { clientShopifyAppProblem } from '@/lib/server/provision-merchant';
import {
  buildShopifyAuthorizeUrl,
  createShopifyOAuthState,
  parseShopifyOAuthState,
  peekShopifyOAuthStateTenantId,
  SHOPIFY_CLIENT_APP_SCOPES,
  type ShopifyOAuthConfig,
} from '@/lib/server/shopify-oauth';
import { readWebhookProductGid, verifyShopifyWebhookHmac } from '@/lib/server/shopify-webhook';

const TENANT = '550e8400-e29b-41d4-a716-446655440000';
const CLIENT_APP: ShopifyOAuthConfig = {
  clientId: 'a'.repeat(32),
  clientSecret: 'client-app-secret-0123456789',
  redirectUri: 'https://www.ashrium.org/api/v1/shopify/oauth/callback',
  scopes: SHOPIFY_CLIENT_APP_SCOPES,
  perClient: true,
};
const OTHER_APP: ShopifyOAuthConfig = { ...CLIENT_APP, clientSecret: 'another-app-secret-0123456789' };

test('webhooks verify against the app secret over the raw body', () => {
  const body = JSON.stringify({ id: 42, admin_graphql_api_id: 'gid://shopify/Product/42' });
  const signature = createHmac('sha256', CLIENT_APP.clientSecret).update(body, 'utf8').digest('base64');
  assert.equal(verifyShopifyWebhookHmac(body, signature, CLIENT_APP.clientSecret), true);
  assert.equal(verifyShopifyWebhookHmac(`${body} `, signature, CLIENT_APP.clientSecret), false);
  assert.equal(verifyShopifyWebhookHmac(body, signature, OTHER_APP.clientSecret), false);
  assert.equal(verifyShopifyWebhookHmac(body, null, CLIENT_APP.clientSecret), false);
  assert.equal(readWebhookProductGid(JSON.parse(body)), 'gid://shopify/Product/42');
  assert.equal(readWebhookProductGid({ id: 7 }), 'gid://shopify/Product/7');
});

test('a client app state is verified only by that app\'s secret', () => {
  const state = createShopifyOAuthState({ tenantId: TENANT, shopDomain: 'acme.myshopify.com' }, CLIENT_APP);
  assert.equal(peekShopifyOAuthStateTenantId(state), TENANT);
  assert.equal(parseShopifyOAuthState(state, CLIENT_APP)?.tenantId, TENANT);
  assert.equal(parseShopifyOAuthState(state, OTHER_APP), null);

  const authorize = new URL(buildShopifyAuthorizeUrl('acme.myshopify.com', state, CLIENT_APP));
  assert.equal(authorize.host, 'acme.myshopify.com');
  assert.equal(authorize.searchParams.get('client_id'), CLIENT_APP.clientId);
  assert.equal(authorize.searchParams.get('scope'), 'read_products,read_metaobjects');
});

test('client app registration is checked before anything is created', () => {
  const good = {
    clientId: 'ecf01cd85aace61cf12d948ca1220ab7',
    clientSecret: 'shpss_0123456789abcdef0123',
    shopDomain: 'aiw7ir-yv.myshopify.com',
    installUrl: 'https://admin.shopify.com/oauth/install_custom_app?client_id=ecf01cd8&signature=x',
  };
  assert.equal(clientShopifyAppProblem(good), null);
  assert.match(clientShopifyAppProblem({ ...good, clientId: 'short' }) ?? '', /32/);
  assert.match(clientShopifyAppProblem({ ...good, shopDomain: 'acme.com' }) ?? '', /myshopify/);
  assert.match(clientShopifyAppProblem({ ...good, installUrl: 'https://evil.example/install' }) ?? '', /shopify\.com/);
  assert.match(clientShopifyAppProblem({ ...good, installUrl: 'http://admin.shopify.com/x' }) ?? '', /shopify\.com/);
});
