import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { shouldDispatchPattern } from '@/lib/catalog/pattern-ingest';
import { detectUnsupportedGeometry } from '@/lib/catalog/unsupported-geometry';
import {
  describePatternCogMismatch,
  isPatternCogBodyImageMismatch,
  isPatternCogBodyOutput,
  parsePatternPredictionOutput,
  rewritePatternCogError,
} from '@/lib/ml/replicate';
import { REST_LENGTH_SCHEMA, type CatalogGarmentDraft } from '@/types/garment';
import { MHR_TOPOLOGY_VERSION } from '@/types/hmr';

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

test('task=pattern body-image errors are a deployment mismatch, not a fallback', () => {
  const replicate422 = [
    'Replicate API request failed (422):',
    '{"detail":"- input.front_image: field required\\n- input.side_image: field required"}',
  ].join(' ');
  assert.equal(isPatternCogBodyImageMismatch(replicate422), true);
  assert.equal(isPatternCogBodyImageMismatch('front_image is required'), true);
  assert.equal(isPatternCogBodyImageMismatch('task=body requires front_image and side_image.'), true);
  assert.equal(
    isPatternCogBodyImageMismatch('Replicate prediction timed out after 180000ms (status processing).'),
    false,
  );
  assert.equal(
    isPatternCogBodyImageMismatch('task=pattern requires at least one size with published girths.'),
    false,
  );

  const rewritten = rewritePatternCogError(new Error(replicate422));
  assert.equal(rewritten.message, describePatternCogMismatch());
  assert.match(rewritten.message, /REPLICATE_DEPLOYMENT/);
  assert.match(rewritten.message, /task=pattern/);
  assert.match(rewritten.message, /no mock, Laplacian, or fixture fallback/i);

  const unrelated = rewritePatternCogError(new Error('Replicate pattern failed.'));
  assert.equal(unrelated.message, 'Replicate pattern failed.');
});

test('body Cog output on a pattern request is a mismatch, not an approximate mesh', () => {
  const bodyOutput = {
    topology_version: MHR_TOPOLOGY_VERSION,
    shape: [0, 0, 0],
    derived_measurements: { chest_cm: 98, waist_cm: 80, hip_cm: 100 },
  };
  assert.equal(isPatternCogBodyOutput(bodyOutput), true);
  assert.throws(
    () => parsePatternPredictionOutput(bodyOutput),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, describePatternCogMismatch());
      return true;
    },
  );

  const persistSource = readFileSync(
    path.join(process.cwd(), 'lib/catalog/persist-garment.ts'),
    'utf8',
  );
  assert.match(persistSource, /throw rewritePatternCogError\(error\)/);
  assert.doesNotMatch(
    persistSource,
    /catch \(error\) \{\s*return \{ meshes: \[\], approximateFit: true \}/,
  );
});
