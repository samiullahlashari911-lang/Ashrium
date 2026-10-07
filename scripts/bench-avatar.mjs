/**
 * Operator benchmark for the avatar SLA (p95 ≤ 60 s warm / ≤ 180 s cold).
 *
 * Calls the live Modal app (`/session`, `/body`) with HMAC, using ONE
 * consenting, already head-cropped photo pair kept only on this machine:
 *
 *   gpu/bench/front.webp   gpu/bench/side.webp   (gitignored, never committed)
 *   gpu/bench/subject.json {"height_cm":172,"sex":"female","weight_kg":null}
 *
 * Usage:
 *   node scripts/bench-avatar.mjs --runs 10            warm runs (warms first)
 *   node scripts/bench-avatar.mjs --cold               one run after sleeping the GPU
 *   node scripts/bench-avatar.mjs --runs 3 --save-baseline
 *
 * With a saved baseline, every run's girths must stay within ±1 cm
 * (the "faster must not be worse" rule). No mock path: fails closed when
 * MODAL_GPU_URL / ASHRIUM_GPU_HMAC are missing.
 */
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const BENCH = path.join(ROOT, 'gpu', 'bench');
const BASELINE = path.join(BENCH, 'baseline.json');
const GIRTH_TOLERANCE_CM = 1;
const COLD_SETTLE_MS = 210_000; // scaledown_window (180 s) + margin

function readEnv() {
  const file = path.join(ROOT, '.env.local');
  if (!existsSync(file)) {
    throw new Error('.env.local is missing.');
  }
  const env = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) {
      env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const env = readEnv();
const url = env.MODAL_GPU_URL?.trim();
const secret = env.ASHRIUM_GPU_HMAC?.trim();
if (!url || !secret || secret.length < 16) {
  console.error('MODAL_GPU_URL and ASHRIUM_GPU_HMAC must be set in .env.local (deploy gpu/modal_app.py first).');
  process.exit(1);
}

for (const file of ['front.webp', 'side.webp', 'subject.json']) {
  if (!existsSync(path.join(BENCH, file))) {
    console.error(`Missing gpu/bench/${file}. Add one consenting, head-cropped pair (see the header of this script).`);
    process.exit(1);
  }
}

const subject = JSON.parse(readFileSync(path.join(BENCH, 'subject.json'), 'utf8'));
const frontB64 = readFileSync(path.join(BENCH, 'front.webp')).toString('base64');
const sideB64 = readFileSync(path.join(BENCH, 'side.webp')).toString('base64');

async function modal(route, payload, timeoutMs) {
  const raw = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${url}${route}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ashrium-Timestamp': timestamp,
        'X-Ashrium-Signature': signature,
      },
      body: raw,
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${route} ${response.status}: ${text.slice(0, 400)}`);
    }
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timer);
  }
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * (sorted.length - 1)))];
}

async function runBody() {
  const started = performance.now();
  const output = await modal(
    '/body',
    {
      front_image_b64: frontB64,
      side_image_b64: sideB64,
      height_cm: Number(subject.height_cm),
      sex: subject.sex ?? 'unspecified',
      weight_kg: Number(subject.weight_kg ?? 0),
    },
    300_000,
  );
  return { seconds: (performance.now() - started) / 1000, output };
}

const cold = process.argv.includes('--cold');
const runs = cold ? 1 : Number(arg('--runs', '5'));
const saveBaseline = process.argv.includes('--save-baseline');
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null;

if (cold) {
  console.log('Sleeping the GPU and waiting for the container to scale down…');
  await modal('/session', { action: 'sleep', min_containers: 0 }, 60_000);
  await new Promise((resolve) => setTimeout(resolve, COLD_SETTLE_MS));
} else {
  console.log('Warming the GPU…');
  await modal('/session', { action: 'warm', min_containers: 1 }, 60_000);
  // First body call absorbs any remaining @enter; it is reported separately.
  const warmup = await runBody();
  console.log(`warm-up call: ${warmup.seconds.toFixed(1)} s (excluded)`);
}

const results = [];
for (let index = 0; index < runs; index += 1) {
  const { seconds, output } = await runBody();
  const girths = output.derived_measurements ?? {};
  const stages = output.fit_diagnostics?.stage_timings_ms ?? {};
  results.push({ seconds, girths, stages });
  const drift = baseline
    ? ['chest_cm', 'waist_cm', 'hip_cm'].map((key) => Math.abs((girths[key] ?? NaN) - baseline.girths[key]))
    : [];
  const driftNote = drift.length ? ` drift max ${Math.max(...drift).toFixed(2)} cm` : '';
  console.log(
    `run ${index + 1}: ${seconds.toFixed(1)} s  chest ${girths.chest_cm?.toFixed(1)} waist ${girths.waist_cm?.toFixed(1)} hip ${girths.hip_cm?.toFixed(1)}${driftNote}`,
  );
}

const totals = results.map((result) => result.seconds);
console.log(`\n${cold ? 'COLD' : 'WARM'} GPU round trip (excludes upload + Supabase): p50 ${percentile(totals, 0.5).toFixed(1)} s · p95 ${percentile(totals, 0.95).toFixed(1)} s`);
const stageNames = [...new Set(results.flatMap((result) => Object.keys(result.stages)))];
for (const stage of stageNames) {
  const values = results.map((result) => result.stages[stage]).filter((value) => typeof value === 'number');
  if (values.length) {
    console.log(`  ${stage.padEnd(14)} p50 ${(percentile(values, 0.5) / 1000).toFixed(2)} s · p95 ${(percentile(values, 0.95) / 1000).toFixed(2)} s`);
  }
}

if (saveBaseline) {
  const mean = (key) => results.reduce((sum, result) => sum + result.girths[key], 0) / results.length;
  writeFileSync(
    BASELINE,
    `${JSON.stringify({ savedAt: new Date().toISOString(), girths: { chest_cm: mean('chest_cm'), waist_cm: mean('waist_cm'), hip_cm: mean('hip_cm') } }, null, 2)}\n`,
  );
  console.log(`\nBaseline saved to gpu/bench/baseline.json`);
} else if (baseline) {
  const worst = Math.max(
    ...results.flatMap((result) => ['chest_cm', 'waist_cm', 'hip_cm'].map((key) => Math.abs(result.girths[key] - baseline.girths[key]))),
  );
  console.log(`\nGirth consistency vs baseline: worst ${worst.toFixed(2)} cm → ${worst <= GIRTH_TOLERANCE_CM ? 'PASS' : 'FAIL (revert the speed change)'}`);
  if (worst > GIRTH_TOLERANCE_CM) {
    process.exitCode = 2;
  }
}
