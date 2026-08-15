import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MERCHANT_PAGE = path.join(ROOT, 'app', 'merchant', 'page.tsx');
const DEFAULT_ORIGIN = 'http://127.0.0.1:3000';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class MerchantRouteCheckError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MerchantRouteCheckError';
  }
}

export function assertMerchantPageExists() {
  if (!existsSync(MERCHANT_PAGE)) {
    throw new MerchantRouteCheckError(`Missing App Router page: ${MERCHANT_PAGE}`);
  }
}

function resolveMerchantUrl() {
  const origin = (process.env.MERCHANT_CHECK_ORIGIN ?? DEFAULT_ORIGIN).replace(/\/$/, '');
  return `${origin}/merchant`;
}

export async function checkMerchantHttpRoute() {
  assertMerchantPageExists();

  const url = resolveMerchantUrl();
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'manual',
    headers: { Accept: 'text/html' },
  });

  const location = response.headers.get('location');

  if (REDIRECT_STATUSES.has(response.status)) {
    throw new MerchantRouteCheckError(
      `GET /merchant redirected (${response.status}) to ${location ?? '(no Location)'}; expected 200 without middleware auth redirects.`,
    );
  }

  if (response.status === 404) {
    throw new MerchantRouteCheckError('GET /merchant returned 404; App Router did not serve app/merchant/page.tsx.');
  }

  if (response.status !== 200) {
    throw new MerchantRouteCheckError(`GET /merchant returned ${response.status}; expected 200.`);
  }

  return { status: response.status, url };
}

export async function waitForMerchantRoute(options = {}) {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 500;
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await checkMerchantHttpRoute();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => {
        setTimeout(resolve, intervalMs);
      });
    }
  }

  const detail = lastError instanceof Error ? lastError.message : 'unknown error';
  throw new MerchantRouteCheckError(`Timed out waiting for GET /merchant. Last error: ${detail}`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    const result = await checkMerchantHttpRoute();
    process.stdout.write(`Merchant route OK: ${result.status} ${result.url}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Merchant route check failed.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
