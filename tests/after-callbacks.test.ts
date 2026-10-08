import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

// Vercel keeps a function alive only for promises an after() callback returns.
// A voided promise is dropped once the response is sent: the avatar job never
// reached Modal, abandoned captures never slept the GPU, and GarmentCode
// grading never ran.
const FILES = [
  'app/api/v1/hmr/route.ts',
  'app/api/v1/hmr/warmup/route.ts',
  'lib/catalog/persist-garment.ts',
];

for (const file of FILES) {
  test(`${file}: after() returns its background work`, () => {
    const source = readFileSync(path.join(process.cwd(), file), 'utf8');
    assert.match(source, /after\(\(\) => /);
    assert.doesNotMatch(source, /after\(\(\) => \{\s*void /);
  });
}
