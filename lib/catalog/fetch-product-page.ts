import type { ShopifyProduct } from '@/lib/catalog/shopify-admin';

const FETCH_TIMEOUT_MS = 5000;
const HTML_BYTE_CAP = 400_000;

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

export async function fetchStorefrontProductHtml(url: string): Promise<string> {
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
      headers: { Accept: 'text/html' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return '';
    }

    const html = await response.text();
    return html.length > HTML_BYTE_CAP ? html.slice(0, HTML_BYTE_CAP) : html;
  } catch {
    return '';
  }
}
