import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEXT_BIN = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
const DEFAULT_ORIGIN = 'http://127.0.0.1:3000';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

class LiveDashboardCheckError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LiveDashboardCheckError';
  }
}

function resolveDashboardUrl() {
  const origin = (process.env.MERCHANT_CHECK_ORIGIN ?? DEFAULT_ORIGIN).replace(/\/$/, '');
  return `${origin}/merchant/dashboard`;
}

async function checkLiveDashboardRoute() {
  const url = resolveDashboardUrl();
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'manual',
    headers: { Accept: 'text/html' },
  });

  if (response.status === 404) {
    throw new LiveDashboardCheckError(
      'GET /merchant/dashboard returned 404; live dashboard route is missing.',
    );
  }

  if (response.status === 200 || REDIRECT_STATUSES.has(response.status)) {
    return { status: response.status, url };
  }

  throw new LiveDashboardCheckError(
    `GET /merchant/dashboard returned ${response.status}; expected 200 or a sign-in redirect.`,
  );
}

async function waitForLiveDashboard(options = {}) {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const intervalMs = options.intervalMs ?? 400;
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await checkLiveDashboardRoute();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => {
        setTimeout(resolve, intervalMs);
      });
    }
  }

  const detail = lastError instanceof Error ? lastError.message : 'unknown error';
  throw new LiveDashboardCheckError(`Timed out waiting for GET /merchant/dashboard. Last error: ${detail}`);
}

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
    const result = await waitForLiveDashboard({ timeoutMs: 45_000, intervalMs: 400 });
    process.stdout.write(
      `\n[dev:check] Live dashboard reachable: ${result.status} ${result.url}\n\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Live dashboard check failed.';
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
