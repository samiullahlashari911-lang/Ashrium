import type { ShopifyProduct } from '@/lib/catalog/shopify-admin';

const FETCH_TIMEOUT_MS = 12_000;
const HTML_BYTE_CAP = 1_500_000;

export function storefrontProductUrl(shopDomain: string, product: ShopifyProduct): string {
  if (product.onlineStoreUrl.startsWith('https://')) {
    return product.onlineStoreUrl;
  }

  const host = shopDomain.replace(/^https?:\/\//i, '').split('/')[0]?.toLowerCase() ?? '';
  if (!host || !product.handle) {
    return '';
  }

  return `https://${host}/products/${encodeURIComponent(product.handle)}`;
}

export function storefrontProductJsUrl(shopDomain: string, product: ShopifyProduct): string {
  const host = shopDomain.replace(/^https?:\/\//i, '').split('/')[0]?.toLowerCase() ?? '';
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

export async function fetchStorefrontProductJsHtml(url: string): Promise<string> {
  const raw = await fetchHttpsText(url, 'application/json');
  if (!raw) {
    return '';
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'body_html' in parsed) {
      const html = (parsed as { body_html?: unknown }).body_html;
      return typeof html === 'string' ? html : '';
    }
  } catch {
    return raw;
  }

  return '';
}

export async function fetchStorefrontProductCorpus(
  shopDomain: string,
  product: ShopifyProduct,
): Promise<string> {
  const [html, jsHtml] = await Promise.all([
    fetchStorefrontProductHtml(storefrontProductUrl(shopDomain, product)),
    fetchStorefrontProductJsHtml(storefrontProductJsUrl(shopDomain, product)),
  ]);
  return [jsHtml, html].filter((chunk) => chunk.length > 0).join('\n');
}
