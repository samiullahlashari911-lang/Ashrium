import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseShopifyProductSelector } from '@/lib/catalog/shopify-selector';

test('parses storefront URLs, GIDs, numeric ids, and SKUs', () => {
  assert.deepEqual(
    parseShopifyProductSelector('https://brand.myshopify.com/products/essential-tee'),
    { kind: 'handle', handle: 'essential-tee' },
  );
  assert.deepEqual(
    parseShopifyProductSelector('https://brand.myshopify.com/products/essential-tee?variant=998877'),
    { kind: 'variant_gid', id: 'gid://shopify/ProductVariant/998877' },
  );
  assert.deepEqual(
    parseShopifyProductSelector('https://admin.shopify.com/store/brand/products/1234567890'),
    { kind: 'product_gid', id: 'gid://shopify/Product/1234567890' },
  );
  assert.deepEqual(
    parseShopifyProductSelector('gid://shopify/Product/55'),
    { kind: 'product_gid', id: 'gid://shopify/Product/55' },
  );
  assert.deepEqual(
    parseShopifyProductSelector('gid://shopify/ProductVariant/77'),
    { kind: 'variant_gid', id: 'gid://shopify/ProductVariant/77' },
  );
  assert.deepEqual(parseShopifyProductSelector('1234567890'), {
    kind: 'product_gid',
    id: 'gid://shopify/Product/1234567890',
  });
  assert.deepEqual(parseShopifyProductSelector('SKU-DENIM-001'), { kind: 'sku', sku: 'SKU-DENIM-001' });
  assert.equal(parseShopifyProductSelector('   '), null);
});
