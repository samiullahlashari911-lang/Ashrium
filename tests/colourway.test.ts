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

test('denim blue reads as indigo', () => {
  assert.equal(colourwayHex('Plus Size High-Waisted Elastic Waistband Casual Jeans / Blue'), '#3d5277');
  assert.equal(colourwayHex('Plus Size High-Waisted Elastic Waistband Casual Jeans / Light Blue'), '#7d93b5');
  assert.equal(colourwayHex("Men's Shirt / Navy Blue"), '#1f2a44');
});
