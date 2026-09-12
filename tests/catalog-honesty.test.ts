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

test('Legendary inch tables persist category-complete charts without inventing girths', () => {
  const camoHtml = `
    <table>
      <tr><th>Size</th><th>Top Length</th><th>Bust</th></tr>
      <tr><td>M</td><td>28</td><td>44</td></tr>
    </table>
    95% polyester, 5% elastane
  `;
  const camoProduct: ShopifyProduct = {
    id: 'gid://shopify/Product/10',
    title: 'Camo Print Casual T-Shirt',
    handle: 'camo-print-casual-t-shirt',
    productType: 'T-Shirt',
    tags: [],
    description: '',
    descriptionHtml: '',
    onlineStoreUrl: 'https://legendary1122.myshopify.com/products/camo-print-casual-t-shirt',
    imageUrl: null,
    metafields: [],
    variants: [
      {
        id: 'gid://shopify/ProductVariant/10',
        sku: '100100634041270',
        title: 'M',
        selectedOptions: [{ name: 'Size', value: 'M' }],
        metafields: [],
      },
    ],
  };
  const [camo] = draftsFromShopifyProduct(camoProduct, camoHtml);
  assert.equal(camo.mode, 'B');
  assert.equal(camo.approximateFit, true);
  assert.equal(camo.sizeVariants.length, 1);
  assert.ok((camo.sizeVariants[0]?.chestCm ?? 0) > 0);
  assert.ok((camo.sizeVariants[0]?.lengthCm ?? 0) > 0);
  assert.equal(camo.sizeVariants[0]?.waistCm, null);
  assert.equal(camo.sizeVariants[0]?.hipCm, null);

  const pantHtml = `
    <table>
      <tr><th>Size</th><th>Waist</th><th>Hip</th><th>Bottom Length</th></tr>
      <tr><td>M</td><td>30</td><td>40</td><td>40</td></tr>
    </table>
  `;
  const pantProduct: ShopifyProduct = {
    ...camoProduct,
    id: 'gid://shopify/Product/11',
    title: 'Camo Joggers',
    handle: 'camo-joggers',
    productType: 'Pants',
    variants: [
      {
        id: 'gid://shopify/ProductVariant/11',
        sku: 'JOGGER-M',
        title: 'M',
        selectedOptions: [{ name: 'Size', value: 'M' }],
        metafields: [],
      },
    ],
  };
  const [pant] = draftsFromShopifyProduct(pantProduct, pantHtml);
  assert.equal(pant.category, 'pant');
  assert.equal(pant.sizeVariants.length, 1);
  assert.ok((pant.sizeVariants[0]?.waistCm ?? 0) > 0);
  assert.ok((pant.sizeVariants[0]?.hipCm ?? 0) > 0);
  assert.equal(pant.sizeVariants[0]?.chestCm, null);

  const annie = scanSizeChartFromPage('Measurements by inches. S:Bust 34-36 in, Waist 26-28 in');
  assert.equal(annie.get('S')?.chestCm, 36 * 2.54);
  assert.equal(annie.get('S')?.waistCm, 28 * 2.54);
});

test('children and electronics products are not ingested', () => {
  const kids: ShopifyProduct = {
    id: 'gid://shopify/Product/12',
    title: "Kids Polo",
    handle: 'kids-polo',
    productType: 'Polo',
    tags: ['kids'],
    description: '',
    descriptionHtml: '',
    onlineStoreUrl: 'https://store.example/products/kids-polo',
    imageUrl: null,
    metafields: [],
    variants: [
      {
        id: 'gid://shopify/ProductVariant/12',
        sku: 'KIDS-POLO',
        title: 'M',
        selectedOptions: [{ name: 'Size', value: 'M' }],
        metafields: [],
      },
    ],
  };
  assert.equal(draftsFromShopifyProduct(kids).length, 0);

  const lamp: ShopifyProduct = {
    ...kids,
    id: 'gid://shopify/Product/13',
    title: 'Desk Lamp',
    handle: 'desk-lamp',
    productType: 'Home',
    tags: ['lamp'],
    variants: [
      {
        id: 'gid://shopify/ProductVariant/13',
        sku: 'LAMP-1',
        title: 'Default Title',
        selectedOptions: [],
        metafields: [],
      },
    ],
  };
  assert.equal(draftsFromShopifyProduct(lamp).length, 0);
});

