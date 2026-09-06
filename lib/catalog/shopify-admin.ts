import type { ShopifyProductSelector } from '@/lib/catalog/shopify-selector';

export const SHOPIFY_ADMIN_API_VERSION = '2025-10';

export class ShopifyAdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ShopifyAdminError';
  }
}

export interface ShopifyMetafield {
  namespace: string;
  key: string;
  type: string;
  value: string;
}

export interface ShopifySelectedOption {
  name: string;
  value: string;
}

export interface ShopifyVariant {
  id: string;
  sku: string;
  title: string;
  selectedOptions: ShopifySelectedOption[];
  metafields: ShopifyMetafield[];
}

export interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  productType: string;
  tags: string[];
  description: string;
  descriptionHtml: string;
  onlineStoreUrl: string;
  imageUrl: string | null;
  metafields: ShopifyMetafield[];
  variants: ShopifyVariant[];
}

export interface ShopifyCredentials {
  shopDomain: string;
  adminToken: string;
}

const SHOP_IDENTITY_QUERY = `query ShopIdentity { shop { name myshopifyDomain } }`;

const CATALOG_PRODUCTS_QUERY = `query CatalogProducts($cursor: String) {
  products(first: 50, after: $cursor, query: "status:active") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      title
      handle
      productType
      tags
      description
      descriptionHtml
      onlineStoreUrl
      featuredMedia {
        ... on MediaImage {
          image { url }
        }
      }
      metafields(first: 30) {
        nodes { namespace key type value }
      }
      variants(first: 50) {
        nodes {
          id
          sku
          title
          selectedOptions { name value }
          metafields(first: 20) {
            nodes { namespace key type value }
          }
        }
      }
    }
  }
}`;

const PRODUCT_NODE_FIELDS = `
  id
  title
  handle
  productType
  tags
  description
  descriptionHtml
  onlineStoreUrl
  featuredMedia {
    ... on MediaImage {
      image { url }
    }
  }
  metafields(first: 30) {
    nodes { namespace key type value }
  }
  variants(first: 50) {
    nodes {
      id
      sku
      title
      selectedOptions { name value }
      metafields(first: 20) {
        nodes { namespace key type value }
      }
    }
  }
`;

const PRODUCT_BY_ID_QUERY = `query ProductById($id: ID!) {
  product(id: $id) { ${PRODUCT_NODE_FIELDS} }
}`;

const VARIANT_BY_ID_QUERY = `query VariantById($id: ID!) {
  productVariant(id: $id) {
    product { ${PRODUCT_NODE_FIELDS} }
  }
}`;

const PRODUCTS_SEARCH_QUERY = `query ProductsSearch($query: String!) {
  products(first: 8, query: $query) {
    nodes { ${PRODUCT_NODE_FIELDS} }
  }
}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readNodes<T>(value: unknown, mapNode: (node: Record<string, unknown>) => T): T[] {
  if (!isRecord(value) || !Array.isArray(value.nodes)) {
    return [];
  }

  const nodes: T[] = [];
  for (const node of value.nodes) {
    if (isRecord(node)) {
      nodes.push(mapNode(node));
    }
  }

  return nodes;
}

function readMetafields(value: unknown): ShopifyMetafield[] {
  return readNodes(value, (node) => ({
    namespace: readString(node.namespace),
    key: readString(node.key),
    type: readString(node.type),
    value: readString(node.value),
  })).filter((field) => field.key.length > 0);
}

function readImageUrl(featuredMedia: unknown): string | null {
  if (!isRecord(featuredMedia) || !isRecord(featuredMedia.image)) {
    return null;
  }

  const url = readString(featuredMedia.image.url);
  return url.startsWith('https://') ? url : null;
}

function readProduct(node: Record<string, unknown>): ShopifyProduct {
  const tags = Array.isArray(node.tags)
    ? node.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];

  return {
    id: readString(node.id),
    title: readString(node.title),
    handle: readString(node.handle),
    productType: readString(node.productType),
    tags,
    description: readString(node.description),
    descriptionHtml: readString(node.descriptionHtml),
    onlineStoreUrl: readString(node.onlineStoreUrl),
    imageUrl: readImageUrl(node.featuredMedia),
    metafields: readMetafields(node.metafields),
    variants: readNodes(node.variants, (variant) => ({
      id: readString(variant.id),
      sku: readString(variant.sku).trim(),
      title: readString(variant.title),
      selectedOptions: Array.isArray(variant.selectedOptions)
        ? variant.selectedOptions.flatMap((option) =>
            isRecord(option)
              ? [{ name: readString(option.name), value: readString(option.value) }]
              : [],
          )
        : [],
      metafields: readMetafields(variant.metafields),
    })),
  };
}

async function shopifyGraphql(
  credentials: ShopifyCredentials,
  query: string,
  variables?: Record<string, unknown>,
): Promise<unknown> {
  const url = `https://${credentials.shopDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`;
  const execute = async (): Promise<Response> =>
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': credentials.adminToken,
      },
      body: JSON.stringify(variables ? { query, variables } : { query }),
      cache: 'no-store',
    });

  let response = await execute();
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) ? Math.min(retryAfter * 1000, 5000) : 1000;
    await new Promise((resolve) => {
      setTimeout(resolve, waitMs);
    });
    response = await execute();
  }

  if (response.status === 401 || response.status === 403) {
    throw new ShopifyAdminError('Shopify Admin rejected the stored access token.', response.status);
  }

  if (!response.ok) {
    throw new ShopifyAdminError('Shopify Admin GraphQL request failed.', response.status);
  }

  const payload: unknown = await response.json();
  if (!isRecord(payload)) {
    throw new ShopifyAdminError('Shopify Admin returned an invalid payload.', 502);
  }

  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    const first = payload.errors[0];
    const message = isRecord(first) ? readString(first.message) : '';
    throw new ShopifyAdminError(message || 'Shopify Admin GraphQL returned errors.', 502);
  }

  return payload.data ?? null;
}

export async function verifyShopifyAdminCredentials(
  credentials: ShopifyCredentials,
): Promise<{ shopName: string; myshopifyDomain: string }> {
  const data = await shopifyGraphql(credentials, SHOP_IDENTITY_QUERY);
  if (!isRecord(data) || !isRecord(data.shop)) {
    throw new ShopifyAdminError('Shopify Admin shop identity was empty.', 502);
  }

  const shopName = readString(data.shop.name);
  const myshopifyDomain = readString(data.shop.myshopifyDomain).toLowerCase();
  if (!myshopifyDomain.endsWith('.myshopify.com')) {
    throw new ShopifyAdminError('Shopify Admin shop identity was incomplete.', 502);
  }

  return { shopName, myshopifyDomain };
}

export async function fetchShopifyCatalogProducts(
  credentials: ShopifyCredentials,
  maxPages = 10,
): Promise<ShopifyProduct[]> {
  const products: ShopifyProduct[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const data = await shopifyGraphql(
      credentials,
      CATALOG_PRODUCTS_QUERY,
      cursor ? { cursor } : { cursor: null },
    );

    if (!isRecord(data) || !isRecord(data.products)) {
      break;
    }

    const pageProducts = readNodes(data.products, readProduct).filter(
      (product) => product.id.length > 0 && product.variants.length > 0,
    );
    products.push(...pageProducts);

    const pageInfo = isRecord(data.products.pageInfo) ? data.products.pageInfo : null;
    const hasNextPage = pageInfo?.hasNextPage === true;
    const endCursor = pageInfo ? readString(pageInfo.endCursor) : '';
    if (!hasNextPage || endCursor.length === 0) {
      break;
    }

    cursor = endCursor;
  }

  return products;
}

function isUsableProduct(product: ShopifyProduct): boolean {
  return product.id.length > 0 && product.variants.length > 0;
}

function productFromGraphqlNode(value: unknown): ShopifyProduct | null {
  if (!isRecord(value)) {
    return null;
  }

  const product = readProduct(value);
  return isUsableProduct(product) ? product : null;
}

function escapeShopifySearchTerm(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export async function fetchShopifyProductById(
  credentials: ShopifyCredentials,
  productGid: string,
): Promise<ShopifyProduct | null> {
  const data = await shopifyGraphql(credentials, PRODUCT_BY_ID_QUERY, { id: productGid });
  if (!isRecord(data)) {
    return null;
  }

  return productFromGraphqlNode(data.product);
}

export async function fetchShopifyProductByVariantId(
  credentials: ShopifyCredentials,
  variantGid: string,
): Promise<ShopifyProduct | null> {
  const data = await shopifyGraphql(credentials, VARIANT_BY_ID_QUERY, { id: variantGid });
  if (!isRecord(data) || !isRecord(data.productVariant)) {
    return null;
  }

  return productFromGraphqlNode(data.productVariant.product);
}

export async function searchShopifyCatalogProducts(
  credentials: ShopifyCredentials,
  query: string,
): Promise<ShopifyProduct[]> {
  const data = await shopifyGraphql(credentials, PRODUCTS_SEARCH_QUERY, { query });
  if (!isRecord(data) || !isRecord(data.products)) {
    return [];
  }

  return readNodes(data.products, readProduct).filter(isUsableProduct);
}

export async function fetchShopifyProductBySelector(
  credentials: ShopifyCredentials,
  selector: ShopifyProductSelector,
): Promise<ShopifyProduct | null> {
  switch (selector.kind) {
    case 'product_gid':
      return fetchShopifyProductById(credentials, selector.id);
    case 'variant_gid':
      return fetchShopifyProductByVariantId(credentials, selector.id);
    case 'handle': {
      const handle = escapeShopifySearchTerm(selector.handle);
      const matches = await searchShopifyCatalogProducts(
        credentials,
        `status:active AND handle:${handle}`,
      );
      return matches.find((product) => product.handle === selector.handle) ?? matches[0] ?? null;
    }
    case 'sku': {
      const sku = escapeShopifySearchTerm(selector.sku);
      const skuMatches = await searchShopifyCatalogProducts(
        credentials,
        `status:active AND sku:${sku}`,
      );
      const exactSku = skuMatches.find((product) =>
        product.variants.some((variant) => variant.sku === selector.sku),
      );
      if (exactSku) {
        return exactSku;
      }

      const handleMatches = await searchShopifyCatalogProducts(
        credentials,
        `status:active AND handle:${sku}`,
      );
      return (
        handleMatches.find((product) => product.handle === selector.sku)
        ?? skuMatches[0]
        ?? handleMatches[0]
        ?? null
      );
    }
  }
}
