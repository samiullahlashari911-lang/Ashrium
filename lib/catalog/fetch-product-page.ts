import type { ShopifyProduct } from '@/lib/catalog/shopify-admin';

const FETCH_TIMEOUT_MS = 12_000;
const HTML_BYTE_CAP = 1_500_000;

function shopHostname(shopDomain: string): string {
  return shopDomain.replace(/^https?:\/\//i, '').split('/')[0]?.toLowerCase() ?? '';
}

export function storefrontHostsForCatalog(
  shopDomain: string,
  extraOrigins: readonly string[] = [],
): string[] {
  const hosts = new Set<string>();
  const shopHost = shopHostname(shopDomain);
  if (shopHost) {
    hosts.add(shopHost);
  }

  for (const origin of extraOrigins) {
    const trimmed = origin.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const hostname = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
        .hostname
        .toLowerCase();
      if (hostname) {
        hosts.add(hostname);
      }
    } catch {
      // Skip malformed allowlist rows.
    }
  }

  return [...hosts];
}

export function storefrontProductUrl(shopDomain: string, product: ShopifyProduct): string {
  if (product.onlineStoreUrl.startsWith('https://')) {
    return product.onlineStoreUrl;
  }

  const host = shopHostname(shopDomain);
  if (!host || !product.handle) {
    return '';
  }

  return `https://${host}/products/${encodeURIComponent(product.handle)}`;
}

export function storefrontProductJsUrl(shopDomain: string, product: ShopifyProduct): string {
  const host = shopHostname(shopDomain);
  if (!host || !product.handle) {
    return '';
  }

  return `https://${host}/products/${encodeURIComponent(product.handle)}.js`;
}

async function fetchHttpsText(url: string, accept: string): Promise<string> {
  if (!url.startsWith('https://')) {
    return '';
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      return '';
    }

    const response = await fetch(parsed.toString(), {
      cache: 'no-store',
      redirect: 'follow',
      headers: { Accept: accept },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return '';
    }

    const text = await response.text();
    return text.length > HTML_BYTE_CAP ? text.slice(0, HTML_BYTE_CAP) : text;
  } catch {
    return '';
  }
}

export async function fetchStorefrontProductHtml(url: string): Promise<string> {
  return fetchHttpsText(url, 'text/html');
}

export function extractStorefrontProductJsHtml(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return raw;
    }

    const record = parsed as Record<string, unknown>;
    if (typeof record.body_html === 'string' && record.body_html.trim().length > 0) {
      return record.body_html;
    }

    // Shopify /products/{handle}.js uses `description`, not REST `body_html`.
    if (typeof record.description === 'string' && record.description.trim().length > 0) {
      return record.description;
    }

    return '';
  } catch {
    return raw;
  }
}

export async function fetchStorefrontProductJsHtml(url: string): Promise<string> {
  const raw = await fetchHttpsText(url, 'application/json');
  if (!raw) {
    return '';
  }

  return extractStorefrontProductJsHtml(raw);
}

export async function fetchStorefrontProductCorpus(
  shopDomain: string,
  product: ShopifyProduct,
  extraOrigins: readonly string[] = [],
): Promise<string> {
  const htmlUrls = new Set<string>();
  const jsUrls = new Set<string>();
  const canonicalHtml = storefrontProductUrl(shopDomain, product);
  if (canonicalHtml) {
    htmlUrls.add(canonicalHtml);
  }

  for (const host of storefrontHostsForCatalog(shopDomain, extraOrigins)) {
    if (!product.handle) {
      continue;
    }

    htmlUrls.add(`https://${host}/products/${encodeURIComponent(product.handle)}`);
    jsUrls.add(`https://${host}/products/${encodeURIComponent(product.handle)}.js`);
  }

  const [htmlChunks, jsChunks] = await Promise.all([
    Promise.all([...htmlUrls].map((url) => fetchStorefrontProductHtml(url))),
    Promise.all([...jsUrls].map((url) => fetchStorefrontProductJsHtml(url))),
  ]);

  return [...jsChunks, ...htmlChunks].filter((chunk) => chunk.length > 0).join('\n');
}
