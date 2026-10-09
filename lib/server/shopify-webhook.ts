import { createHmac, timingSafeEqual } from 'node:crypto';

/** Shopify signs the raw body: base64(HMAC-SHA256(body, app secret)). */
export function verifyShopifyWebhookHmac(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) {
    return false;
  }
  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64'));
  const provided = Buffer.from(header.trim());
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

/** Product GID from a products/* webhook body. */
export function readWebhookProductGid(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const record = payload as { admin_graphql_api_id?: unknown; id?: unknown };
  if (typeof record.admin_graphql_api_id === 'string') {
    return record.admin_graphql_api_id;
  }
  return typeof record.id === 'number' || typeof record.id === 'string'
    ? `gid://shopify/Product/${record.id}`
    : null;
}
