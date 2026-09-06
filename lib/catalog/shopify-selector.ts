export type ShopifyProductSelector =
  | { kind: 'product_gid'; id: string }
  | { kind: 'variant_gid'; id: string }
  | { kind: 'handle'; handle: string }
  | { kind: 'sku'; sku: string };

const PRODUCT_GID_PATTERN = /^gid:\/\/shopify\/Product\/(\d+)$/i;
const VARIANT_GID_PATTERN = /^gid:\/\/shopify\/ProductVariant\/(\d+)$/i;
const NUMERIC_ID_PATTERN = /^\d{1,20}$/;

function productGid(numericId: string): string {
  return `gid://shopify/Product/${numericId}`;
}

function variantGid(numericId: string): string {
  return `gid://shopify/ProductVariant/${numericId}`;
}

function looksLikeUrl(raw: string): boolean {
  return (
    /^https?:\/\//i.test(raw)
    || raw.includes('myshopify.com')
    || raw.includes('admin.shopify.com')
    || raw.includes('/products/')
  );
}

function parseAsUrl(raw: string): ShopifyProductSelector | null {
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return null;
  }

  const variantParam = url.searchParams.get('variant');
  if (variantParam && NUMERIC_ID_PATTERN.test(variantParam)) {
    return { kind: 'variant_gid', id: variantGid(variantParam) };
  }

  const productPath = url.pathname.match(/\/products\/([^/]+)/i);
  const slug = productPath?.[1] ? decodeURIComponent(productPath[1]).trim() : '';
  if (slug) {
    if (NUMERIC_ID_PATTERN.test(slug)) {
      return { kind: 'product_gid', id: productGid(slug) };
    }
    return { kind: 'handle', handle: slug };
  }

  return null;
}

/**
 * Accepts a storefront or Admin product URL, Product/Variant GID, numeric
 * product id, handle, or SKU. Returns null when the input is empty.
 */
export function parseShopifyProductSelector(raw: string): ShopifyProductSelector | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 512) {
    return null;
  }

  const productGidMatch = trimmed.match(PRODUCT_GID_PATTERN);
  if (productGidMatch?.[1]) {
    return { kind: 'product_gid', id: productGid(productGidMatch[1]) };
  }

  const variantGidMatch = trimmed.match(VARIANT_GID_PATTERN);
  if (variantGidMatch?.[1]) {
    return { kind: 'variant_gid', id: variantGid(variantGidMatch[1]) };
  }

  if (looksLikeUrl(trimmed)) {
    return parseAsUrl(trimmed);
  }

  if (NUMERIC_ID_PATTERN.test(trimmed)) {
    return { kind: 'product_gid', id: productGid(trimmed) };
  }

  return { kind: 'sku', sku: trimmed };
}
