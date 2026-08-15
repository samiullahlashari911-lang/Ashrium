import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { waitForMerchantRoute } from './check-merchant-route.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEXT_BIN = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');

const nextArgs = ['dev', ...process.argv.slice(2)];
const child = spawn(process.execPath, [NEXT_BIN, ...nextArgs], {
  cwd: ROOT,
  env: process.env,
  stdio: ['inherit', 'pipe', 'pipe'],
  windowsHide: true,
});

let checkStarted = false;

function forward(chunk, stream) {
  stream.write(chunk);

  if (checkStarted) {
    return;
  }

  const text = chunk.toString('utf8');
  if (/Ready in|Local:/i.test(text)) {
    checkStarted = true;
    void runRouteCheck();
  }
}

async function runRouteCheck() {
  try {
    const result = await waitForMerchantRoute({ timeoutMs: 45_000, intervalMs: 400 });
    process.stdout.write(`\n[dev:check] Merchant analytics served: ${result.status} ${result.url} (no redirect)\n\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Merchant route check failed.';
    process.stderr.write(`\n[dev:check] ${message}\n`);
  }
}

child.stdout.on('data', (chunk) => forward(chunk, process.stdout));
child.stderr.on('data', (chunk) => forward(chunk, process.stderr));

child.on('error', (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

const shutdown = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
