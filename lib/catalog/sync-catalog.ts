import {
  fetchStorefrontProductCorpus,
} from '@/lib/catalog/fetch-product-page';
import { persistCatalogGarment } from '@/lib/catalog/persist-garment';
import { draftsFromShopifyProduct, shouldIngestShopifyProduct } from '@/lib/catalog/parse-product';
import {
  fetchShopifyCatalogProducts,
  fetchShopifyProductBySelector,
  type ShopifyCredentials,
  type ShopifyProduct,
} from '@/lib/catalog/shopify-admin';
import { parseShopifyProductSelector } from '@/lib/catalog/shopify-selector';
import { createServiceClient } from '@/lib/supabase/service';
import type { CatalogGarmentDraft } from '@/types/garment';

export interface CatalogSyncError {
  sku: string;
  message: string;
}

export interface CatalogSyncResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: CatalogSyncError[];
}

const STOREFRONT_FETCH_CONCURRENCY = 6;

async function mapLimit<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  let nextIndex = 0;
  const run = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const current = items[nextIndex];
      nextIndex += 1;
      if (current === undefined) {
        continue;
      }

      await worker(current);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
}

async function persistShopifyProductDrafts(
  tenantId: string,
  credentials: ShopifyCredentials,
  pending: Array<{ product: ShopifyProduct; drafts: CatalogGarmentDraft[] }>,
): Promise<CatalogSyncResult> {
  await mapLimit(pending, STOREFRONT_FETCH_CONCURRENCY, async (item) => {
    const corpus = await fetchStorefrontProductCorpus(credentials.shopDomain, item.product);
    if (corpus.length === 0) {
      return;
    }

    item.drafts = draftsFromShopifyProduct(item.product, corpus);
  });

  const supabase = createServiceClient();
  const result: CatalogSyncResult = {
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  for (const item of pending) {
    if (item.drafts.length === 0) {
      result.skipped += 1;
      continue;
    }

    for (const draft of item.drafts) {
      try {
        const persisted = await persistCatalogGarment(supabase, tenantId, draft);
        if (persisted.created) {
          result.imported += 1;
        } else {
          result.updated += 1;
        }
      } catch (error) {
        result.errors.push({
          sku: draft.sku,
          message: error instanceof Error ? error.message : 'Unable to persist garment.',
        });
      }
    }
  }

  return result;
}

async function ingestShopifyProducts(
  tenantId: string,
  credentials: ShopifyCredentials,
  products: readonly ShopifyProduct[],
): Promise<CatalogSyncResult> {
  const pending: Array<{ product: ShopifyProduct; drafts: CatalogGarmentDraft[] }> = products
    .filter(shouldIngestShopifyProduct)
    .map((product) => ({
      product,
      drafts: draftsFromShopifyProduct(product),
    }));

  const skipped = products.length - pending.length;
  const result = await persistShopifyProductDrafts(tenantId, credentials, pending);
  return { ...result, skipped: result.skipped + skipped };
}

export async function syncShopifyCatalog(
  tenantId: string,
  credentials: ShopifyCredentials,
): Promise<CatalogSyncResult> {
  const products = await fetchShopifyCatalogProducts(credentials);
  return ingestShopifyProducts(tenantId, credentials, products);
}

export async function syncShopifyProduct(
  tenantId: string,
  credentials: ShopifyCredentials,
  selectorInput: string,
): Promise<CatalogSyncResult> {
  const selector = parseShopifyProductSelector(selectorInput);
  if (!selector) {
    throw new Error('Enter a Shopify product URL, product ID, variant ID, or SKU.');
  }

  const product = await fetchShopifyProductBySelector(credentials, selector);
  if (!product) {
    throw new Error('No matching Shopify product was found for that URL, ID, or SKU.');
  }

  return ingestShopifyProducts(tenantId, credentials, [product]);
}
