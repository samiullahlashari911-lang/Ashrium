import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shouldDispatchPattern } from '@/lib/catalog/pattern-ingest';
import { detectUnsupportedGeometry } from '@/lib/catalog/unsupported-geometry';
import { parsePatternPredictionOutput } from '@/lib/ml/replicate';
import { REST_LENGTH_SCHEMA, type CatalogGarmentDraft } from '@/types/garment';

function teeDraft(overrides: Partial<CatalogGarmentDraft> = {}): CatalogGarmentDraft {
  return {
    sku: 'ESSENTIAL-TEE',
    name: 'Essential Tee',
    category: 'tee',
    composition: { cotton: 100 },
    gsm: 180,
    ingestConfidence: 0.82,
    ingestTier: 2,
    mode: 'B',
    approximateFit: false,
    mechanical: {
      tensileStiffness: 90,
      bendingRigidity: 0.04,
      shearStiffness: 45,
      areaDensity: 0.18,
    },
    cadPatternUrl: null,
    sizeVariants: [
      {
        sizeCode: 'M',
        chestCm: 104,
        waistCm: 88,
        hipCm: 104,
        lengthCm: 70,
        externalSku: 'TEE-M',
        measurementsFromSource: true,
      },
    ],
    ingestCorpus: 'Essential Tee 100% cotton short sleeve',
    ...overrides,
  };
}

test('hoods, lapels, cargo, and knitwear are unsupported for 3D', () => {
  assert.equal(detectUnsupportedGeometry({ category: 'outerwear', title: 'Zip Hoodie' }), 'hood');
  assert.equal(detectUnsupportedGeometry({ category: 'outerwear', title: 'Wool Blazer' }), 'lapel');
  assert.equal(detectUnsupportedGeometry({ category: 'pant', title: 'Cargo Pant' }), 'cargo');
  assert.equal(detectUnsupportedGeometry({ category: 'tee', title: 'Merino Knit Sweater' }), 'knit');
  assert.equal(detectUnsupportedGeometry({ category: 'other', title: 'Belt' }), 'unsupported category');
  assert.equal(detectUnsupportedGeometry({ category: 'tee', title: 'Essential Cotton Tee' }), null);
});

test('pattern dispatch skips unsupported styles and empty charts', () => {
  assert.equal(shouldDispatchPattern(teeDraft()), true);
  assert.equal(shouldDispatchPattern(teeDraft({ name: 'Pullover Hoodie', category: 'outerwear' })), false);
  assert.equal(shouldDispatchPattern(teeDraft({ sizeVariants: [] })), false);
});

test('parsePatternPredictionOutput accepts GarmentCode rest-length meshes and rejects bad status', () => {
  const mesh = {
    schema: REST_LENGTH_SCHEMA,
    category: 'tee',
    sizeCode: 'M',
    measurements: { chestCm: 104, waistCm: 88, hipCm: 104, lengthCm: 70 },
    rows: 2,
    cols: 2,
    vertices: [0, 0, 0.1, 0, 0, 0.2, 0.1, 0.2],
    edges: [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 3],
    ],
    restLengths: [0.1, 0.2, 0.224, 0.1],
  };

  const parsed = parsePatternPredictionOutput({
    task: 'pattern',
    status: 'ok',
    unsupported_reason: null,
    meshes: [mesh],
  });
  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.meshes.length, 1);
  assert.equal(parsed.meshes[0]?.sizeCode, 'M');

  const rejected = parsePatternPredictionOutput({
    task: 'pattern',
    status: 'self_intersecting',
    unsupported_reason: 'self-intersecting 2D pattern for size M',
    meshes: [],
  });
  assert.equal(rejected.status, 'self_intersecting');
  assert.equal(rejected.meshes.length, 0);

  assert.throws(() => parsePatternPredictionOutput({ status: 'ok', meshes: [] }));
});
