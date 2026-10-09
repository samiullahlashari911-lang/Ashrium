import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  parseCompositionText,
  scanMaterialFromPage,
  scanSizeChartFromPage,
} from '@/lib/catalog/scan-product-page';

const table = (header: string[], rows: string[][]): string =>
  `<table><tr>${header.map((cell) => `<td>${cell}</td>`).join('')}</tr>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('')}</table>`;

test('a flat (half) chest column is doubled; a full one is kept', () => {
  const flat = scanSizeChartFromPage(
    `Product Measurements (Measurements by inches)${table(['Size', 'Top Length', 'Bust'], [['M', '25.6', '20.5'], ['L', '26.4', '21.3']])}`,
  );
  assert.equal(flat.get('M')?.chestCm, 104.1);
  assert.equal(flat.get('M')?.lengthCm, 65);

  const full = scanSizeChartFromPage(
    `Measurements by inches${table(['Size', 'Bust'], [['S', '39.4'], ['M', '41.3']])}`,
  );
  assert.equal(full.get('S')?.chestCm, 100.1);
});

test('an elastic waist range uses its midpoint', () => {
  const chart = scanSizeChartFromPage(
    `Measurements by inches${table(['Size', 'Waist', 'Hip'], [['S', '27.6-38.6', '38.8']])}`,
  );
  assert.equal(chart.get('S')?.waistCm, 84.1);
  assert.equal(chart.get('S')?.hipCm, 98.6);
});

test('a table wins over the model measurements in the text', () => {
  const html = `Model information: bust 34", waist 26", hip 34", size S. Measurements by inches${table(
    ['Size', 'Bust', 'Top Length'],
    [['S', '39.4', '23.2']],
  )}`;
  assert.equal(scanSizeChartFromPage(html).get('S')?.chestCm, 100.1);
});

test('fabric: one word per fibre, labels and lining cut off, ranged wording', () => {
  assert.deepEqual(parseCompositionText('95%cotton,5%spandex'), { cotton: 95, spandex: 5 });
  assert.deepEqual(
    scanMaterialFromPage('<li>Material composition:100% polyester</li><li>Care instructions:Machine wash cold.</li>'),
    { polyester: 100 },
  );
  assert.deepEqual(
    scanMaterialFromPage('<li>Material composition:Shell:100% polyester+Lining: 100% polyester</li>'),
    { polyester: 100 },
  );
  assert.deepEqual(
    parseCompositionText('Cotton content is at least 80% but less than 90%, with acetate content below 30%.'),
    { cotton: 85, other: 15 },
  );
});
