import assert from 'node:assert/strict';
import test from 'node:test';

import { colourwayHex } from '@/lib/graphics/colourway';

test('the colourway name decides the cloth colour', () => {
  assert.equal(colourwayHex("Men's Crewneck Short Sleeve T-Shirt / White"), '#f2f1ee');
  assert.equal(colourwayHex("Men's Plus Size Casual Loose-Fit Drawstring Joggers / Dark Gray"), '#4a4a4d');
  assert.equal(colourwayHex('High-Waisted Wide-Leg Ribbed Corduroy Pants / Wine Red'), '#6b1f2e');
  assert.equal(colourwayHex('High-Waisted Wide-Leg Ribbed Corduroy Pants / Apricot Color'), '#e9dfcc');
});

test('no colour word: the product photo decides', () => {
  assert.equal(colourwayHex('Floral Embroidered Puff Sleeve Peplum Blouse / Picture Color'), null);
  assert.equal(colourwayHex('Plain Tee'), null);
});
