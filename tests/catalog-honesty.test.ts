import assert from 'node:assert/strict';
import { test } from 'node:test';

import { draftsFromShopifyProduct } from '@/lib/catalog/parse-product';
import { scanSizeChartFromPage } from '@/lib/catalog/scan-product-page';
import type { ShopifyProduct } from '@/lib/catalog/shopify-admin';

test('page chart keeps missing source measurements absent', () => {
  const chart = scanSizeChartFromPage(`
    <table>
      <tr><th>Size</th><th>Chest (cm)</th><th>Waist (cm)</th></tr>
      <tr><td>M</td><td>104</td><td>88</td></tr>
    </table>
  `);

  assert.deepEqual(chart.get('M'), { chestCm: 104, waistCm: 88 });
});

test('incomplete Shopify chart rows stay approximate and are not persisted as size variants', () => {
  const product: ShopifyProduct = {
    id: 'gid://shopify/Product/1',
    title: 'Essential Tee',
    handle: 'essential-tee',
    productType: 'T-Shirt',
    tags: [],
    description: '',
    descriptionHtml: '',
    onlineStoreUrl: 'https://store.example/products/essential-tee',
    imageUrl: null,
    metafields: [
      { namespace: 'custom', key: 'composition', type: 'single_line_text_field', value: '100% Cotton' },
      {
        namespace: 'custom',
        key: 'size_chart',
        type: 'json',
        value: JSON.stringify({ M: { chest_cm: 104, waist_cm: 88, hip_cm: 104 } }),
      },
    ],
    variants: [
      {
        id: 'gid://shopify/ProductVariant/1',
        sku: 'TEE-M',
        title: 'M',
        selectedOptions: [{ name: 'Size', value: 'M' }],
        metafields: [],
      },
    ],
  };

  const [draft] = draftsFromShopifyProduct(product);

  assert.equal(draft.approximateFit, true);
  assert.equal(draft.sizeVariants.length, 0);
});

test('hoodies stay Approximate and are flagged as unsupported geometry', () => {
  const product: ShopifyProduct = {
    id: 'gid://shopify/Product/2',
    title: 'Pullover Hoodie',
    handle: 'pullover-hoodie',
    productType: 'Hoodie',
    tags: ['hoodie'],
    description: 'A hooded sweatshirt with a front pocket.',
    descriptionHtml: '',
    onlineStoreUrl: 'https://store.example/products/pullover-hoodie',
    imageUrl: null,
    metafields: [
      { namespace: 'custom', key: 'composition', type: 'single_line_text_field', value: '100% Cotton' },
      {
        namespace: 'custom',
        key: 'size_chart',
        type: 'json',
        value: JSON.stringify({ M: { chest_cm: 112, waist_cm: 96, hip_cm: 108, length_cm: 72 } }),
      },
    ],
    variants: [
      {
        id: 'gid://shopify/ProductVariant/2',
        sku: 'HOOD-M',
        title: 'M',
        selectedOptions: [{ name: 'Size', value: 'M' }],
        metafields: [],
      },
    ],
  };

  const [draft] = draftsFromShopifyProduct(product);
  assert.equal(draft.approximateFit, true);
  assert.equal(draft.sizeVariants.length, 1);
  assert.equal(draft.sizeVariants[0]?.chestCm, 112);
});

test('complete published tee chart is Mode B and does not invent chest from waist', () => {
  const product: ShopifyProduct = {
    id: 'gid://shopify/Product/3',
    title: 'Essential Tee',
    handle: 'essential-tee',
    productType: 'T-Shirt',
    tags: [],
    description: '',
    descriptionHtml: '',
    onlineStoreUrl: 'https://store.example/products/essential-tee',
    imageUrl: 'https://cdn.example/tee.jpg',
    metafields: [
      { namespace: 'custom', key: 'composition', type: 'single_line_text_field', value: '100% Cotton' },
      {
        namespace: 'custom',
        key: 'size_chart',
        type: 'json',
        value: JSON.stringify({
          M: { chest_cm: 102, waist_cm: 88, hip_cm: 106, length_cm: 70 },
        }),
      },
    ],
    variants: [
      {
        id: 'gid://shopify/ProductVariant/3',
        sku: 'TEE-M',
        title: 'M',
        selectedOptions: [{ name: 'Size', value: 'M' }],
        metafields: [],
      },
    ],
  };

  const [draft] = draftsFromShopifyProduct(product);
  assert.equal(draft.mode, 'B');
  assert.equal(draft.ingestTier, 2);
  assert.equal(draft.approximateFit, false);
  assert.equal(draft.sizeVariants.length, 1);
  assert.equal(draft.sizeVariants[0]?.chestCm, 102);
  assert.equal(draft.sizeVariants[0]?.waistCm, 88);
  assert.notEqual(draft.sizeVariants[0]?.chestCm, (draft.sizeVariants[0]?.waistCm ?? 0) + 16);
});
