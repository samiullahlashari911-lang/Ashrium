import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ShopifyAccessScopeError,
  ShopifyAdminError,
  assertShopifyReadProductsAccess,
  catalogSyncShopifyFailure,
  describeMissingShopifyReadProducts,
  isShopifyReadProductsGraphqlDenial,
} from '@/lib/catalog/shopify-admin';

const ACCESS_DENIED_PRODUCTS = [
  {
    message: 'Access denied for products field.',
    path: ['products'],
    extensions: { code: 'ACCESS_DENIED' },
  },
];

test('Shopify products ACCESS_DENIED is a read_products scope failure', () => {
  assert.equal(isShopifyReadProductsGraphqlDenial(ACCESS_DENIED_PRODUCTS), true);
  assert.equal(
    isShopifyReadProductsGraphqlDenial([
      { message: 'This app is not approved to access Product. Required access: `read_products` access scope.' },
    ]),
    true,
  );
  assert.equal(
    isShopifyReadProductsGraphqlDenial([{ message: 'Throttled', extensions: { code: 'THROTTLED' } }]),
    false,
  );

  const remediation = describeMissingShopifyReadProducts();
  assert.match(remediation, /read_products/);
  assert.match(remediation, /will not store a token that cannot query products/i);
});

test('catalog sync maps missing read_products separately from a rejected token', () => {
  const scope = catalogSyncShopifyFailure(new ShopifyAccessScopeError());
  assert.ok(scope);
  assert.equal(scope.code, 'SHOPIFY_SCOPE_DENIED');
  assert.equal(scope.status, 403);
  assert.match(scope.message, /read_products/);

  const auth = catalogSyncShopifyFailure(
    new ShopifyAdminError('Shopify Admin rejected the stored access token.', 401),
  );
  assert.ok(auth);
  assert.equal(auth.code, 'SHOPIFY_AUTH_FAILED');
  assert.equal(auth.status, 502);

  assert.equal(catalogSyncShopifyFailure(new Error('No matching Shopify product')), null);
});

test('assertShopifyReadProductsAccess probes products(first: 1) and rejects ACCESS_DENIED', async () => {
  const originalFetch = globalThis.fetch;
  const calls: unknown[] = [];

  globalThis.fetch = (async (_url: URL | RequestInfo, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body ?? '{}')));
    return new Response(
      JSON.stringify({
        errors: ACCESS_DENIED_PRODUCTS,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        assertShopifyReadProductsAccess({
          shopDomain: 'brand.myshopify.com',
          adminToken: 'shpat_test_token_value',
        }),
      (error: unknown) => {
        assert.ok(error instanceof ShopifyAccessScopeError);
        assert.match(error.message, /read_products/);
        return true;
      },
    );
    assert.equal(calls.length, 1);
    const body = calls[0] as { query?: string };
    assert.match(String(body.query), /products\(first:\s*1\)/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('assertShopifyReadProductsAccess accepts a token that can read products', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        data: { products: { nodes: [{ id: 'gid://shopify/Product/1' }] } },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch;

  try {
    await assertShopifyReadProductsAccess({
      shopDomain: 'brand.myshopify.com',
      adminToken: 'shpat_test_token_value',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
