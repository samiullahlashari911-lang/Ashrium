import { catalogSyncShopifyFailure } from '@/lib/catalog/shopify-admin';
import { syncShopifyCatalog, syncShopifyProduct } from '@/lib/catalog/sync-catalog';
import { consumeRateLimit } from '@/lib/server/durable-rate-limit';
import { RATE_LIMITS, RATE_LIMIT_WINDOW_MS } from '@/lib/server/rate-limit';
import { loadShopifyCredentials } from '@/lib/server/shopify-credentials';
import { requireCurrentTenantId } from '@/lib/supabase/tenant';

export const runtime = 'nodejs';
export const maxDuration = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readSelector(request: Request): Promise<string | null> {
  const text = await request.text();
  if (text.trim().length === 0) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    throw new Error('INVALID_REQUEST');
  }

  if (!isRecord(payload)) {
    throw new Error('INVALID_REQUEST');
  }

  if (payload.selector === undefined || payload.selector === null) {
    return null;
  }

  if (typeof payload.selector !== 'string') {
    throw new Error('INVALID_REQUEST');
  }

  const selector = payload.selector.trim();
  return selector.length > 0 ? selector : null;
}

export async function POST(request: Request): Promise<Response> {
  let tenantId: string;
  try {
    tenantId = await requireCurrentTenantId();
  } catch {
    return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const rateLimit = await consumeRateLimit(
    `catalog-sync:${tenantId}`,
    RATE_LIMITS.catalogSync,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!rateLimit.allowed) {
    return Response.json({ code: 'RATE_LIMIT_EXCEEDED' }, { status: 429 });
  }

  let selector: string | null;
  try {
    selector = await readSelector(request);
  } catch {
    return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  }

  const credentials = await loadShopifyCredentials(tenantId);
  if (!credentials) {
    return Response.json({ code: 'SHOPIFY_NOT_CONNECTED' }, { status: 409 });
  }

  try {
    const result = selector
      ? await syncShopifyProduct(tenantId, credentials, selector)
      : await syncShopifyCatalog(tenantId, credentials);
    return Response.json(result, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const shopifyFailure = catalogSyncShopifyFailure(error);
    if (shopifyFailure?.code === 'SHOPIFY_SCOPE_DENIED') {
      return Response.json(
        { code: shopifyFailure.code, message: shopifyFailure.message },
        { status: shopifyFailure.status },
      );
    }
    if (shopifyFailure?.code === 'SHOPIFY_AUTH_FAILED') {
      return Response.json({ code: 'SHOPIFY_AUTH_FAILED' }, { status: 502 });
    }

    return Response.json(
      {
        code: 'SYNC_FAILED',
        message: error instanceof Error ? error.message : 'Catalog sync failed.',
      },
      { status: 502 },
    );
  }
}
