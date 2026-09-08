import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { encryptTenantSecret } from '@/lib/server/secret-crypto';
import { createServiceClient } from '@/lib/supabase/service';

export const SHOPIFY_OAUTH_SCOPES = 'read_products';
const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATE_TTL_SECONDS = 10 * 60;
const TOKEN_REFRESH_BUFFER_SECONDS = 5 * 60;

export interface ShopifyOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface ShopifyOAuthStateClaims {
  exp: number;
  nonce: string;
  returnTo: string;
  shopDomain: string;
  tenantId: string;
}

export interface ShopifyOAuthTokenResponse {
  accessToken: string;
  expiresAt: string | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: string | null;
  scope: string;
}

interface ShopifyOAuthStatePayload extends ShopifyOAuthStateClaims {}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeBase64Url(value: string): string | null {
  try {
    return Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

function signOAuthState(encodedPayload: string, clientSecret: string): string {
  return createHmac('sha256', clientSecret).update(encodedPayload).digest('base64url');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readSafeReturnTo(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return '/settings/integrations';
  }

  return trimmed;
}

function expiresAtFromSeconds(expiresInSeconds: number): string {
  return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
}

function isShopifyOAuthStatePayload(value: unknown): value is ShopifyOAuthStatePayload {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.exp === 'number'
    && Number.isSafeInteger(value.exp)
    && typeof value.nonce === 'string'
    && value.nonce.length >= 16
    && typeof value.returnTo === 'string'
    && typeof value.shopDomain === 'string'
    && SHOP_DOMAIN_PATTERN.test(value.shopDomain)
    && typeof value.tenantId === 'string'
    && UUID_PATTERN.test(value.tenantId)
  );
}

export function normalizeShopifyShopDomain(raw: string): string | null {
  let value = raw.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!value.includes('.')) {
    value = `${value}.myshopify.com`;
  }

  return SHOP_DOMAIN_PATTERN.test(value) ? value : null;
}

export function getShopifyOAuthRedirectUri(): string {
  const explicit = process.env.SHOPIFY_OAUTH_REDIRECT_URI?.trim();
  if (explicit) {
    return explicit;
  }

  const appBaseUrl = process.env.APP_BASE_URL?.trim();
  if (!appBaseUrl) {
    throw new Error('APP_BASE_URL or SHOPIFY_OAUTH_REDIRECT_URI is required for Shopify OAuth.');
  }

  return `${appBaseUrl.replace(/\/$/, '')}/api/v1/shopify/oauth/callback`;
}

export function getShopifyOAuthConfig(): ShopifyOAuthConfig {
  const clientId = process.env.SHOPIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new Error('SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET are required for Shopify OAuth.');
  }

  return {
    clientId,
    clientSecret,
    redirectUri: getShopifyOAuthRedirectUri(),
  };
}

export function createShopifyOAuthState(input: {
  tenantId: string;
  shopDomain: string;
  returnTo?: string;
}): string {
  const config = getShopifyOAuthConfig();
  const claims: ShopifyOAuthStatePayload = {
    exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
    nonce: randomBytes(16).toString('hex'),
    returnTo: readSafeReturnTo(input.returnTo ?? '/settings/integrations'),
    shopDomain: input.shopDomain,
    tenantId: input.tenantId,
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(claims));

  return `${encodedPayload}.${signOAuthState(encodedPayload, config.clientSecret)}`;
}

export function parseShopifyOAuthState(state: string): ShopifyOAuthStateClaims | null {
  let config: ShopifyOAuthConfig;
  try {
    config = getShopifyOAuthConfig();
  } catch {
    return null;
  }

  const [encodedPayload, providedSignature, ...extraParts] = state.split('.');
  if (!encodedPayload || !providedSignature || extraParts.length > 0) {
    return null;
  }

  const expectedSignature = signOAuthState(encodedPayload, config.clientSecret);
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    providedBuffer.length !== expectedBuffer.length
    || !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return null;
  }

  const serializedClaims = decodeBase64Url(encodedPayload);
  if (!serializedClaims) {
    return null;
  }

  try {
    const claims: unknown = JSON.parse(serializedClaims);
    if (!isShopifyOAuthStatePayload(claims) || claims.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }

    return {
      exp: claims.exp,
      nonce: claims.nonce,
      returnTo: readSafeReturnTo(claims.returnTo),
      shopDomain: claims.shopDomain,
      tenantId: claims.tenantId,
    };
  } catch {
    return null;
  }
}

export function buildShopifyAuthorizeUrl(shopDomain: string, state: string): string {
  const config = getShopifyOAuthConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    scope: SHOPIFY_OAUTH_SCOPES,
    redirect_uri: config.redirectUri,
    state,
  });

  return `https://${shopDomain}/admin/oauth/authorize?${params.toString()}`;
}

export function verifyShopifyCallbackHmac(
  query: URLSearchParams,
  clientSecret: string,
): boolean {
  const providedHmac = query.get('hmac');
  if (!providedHmac) {
    return false;
  }

  const message = [...query.entries()]
    .filter(([key]) => key !== 'hmac' && key !== 'signature')
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  const digest = createHmac('sha256', clientSecret).update(message).digest('hex');
  const digestBuffer = Buffer.from(digest, 'utf8');
  const providedBuffer = Buffer.from(providedHmac, 'utf8');

  if (digestBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(digestBuffer, providedBuffer);
}

function parseTokenResponse(payload: unknown): ShopifyOAuthTokenResponse {
  if (!isRecord(payload)) {
    throw new Error('Shopify OAuth token response was invalid.');
  }

  const accessToken = readString(payload.access_token);
  if (accessToken.length < 10) {
    throw new Error('Shopify OAuth token response did not include an access token.');
  }

  const scope = readString(payload.scope);
  const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : null;
  const refreshExpiresIn =
    typeof payload.refresh_token_expires_in === 'number'
      ? payload.refresh_token_expires_in
      : null;
  const refreshToken = readString(payload.refresh_token);

  return {
    accessToken,
    expiresAt: expiresIn !== null && expiresIn > 0 ? expiresAtFromSeconds(expiresIn) : null,
    refreshToken: refreshToken.length > 0 ? refreshToken : null,
    refreshTokenExpiresAt:
      refreshExpiresIn !== null && refreshExpiresIn > 0
        ? expiresAtFromSeconds(refreshExpiresIn)
        : null,
    scope,
  };
}

async function postShopifyOAuthToken(
  shopDomain: string,
  body: URLSearchParams,
): Promise<ShopifyOAuthTokenResponse> {
  const config = getShopifyOAuthConfig();
  const response = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    cache: 'no-store',
  });

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(payload) ? readString(payload.error_description || payload.error) : '';
    throw new Error(message || 'Shopify OAuth token exchange failed.');
  }

  return parseTokenResponse(payload);
}

export async function exchangeShopifyOAuthCode(
  shopDomain: string,
  code: string,
): Promise<ShopifyOAuthTokenResponse> {
  const config = getShopifyOAuthConfig();
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    expiring: '1',
  });

  return postShopifyOAuthToken(shopDomain, body);
}

export async function refreshShopifyAccessToken(
  shopDomain: string,
  refreshToken: string,
): Promise<ShopifyOAuthTokenResponse> {
  const config = getShopifyOAuthConfig();
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  return postShopifyOAuthToken(shopDomain, body);
}

export function shopifyAccessTokenNeedsRefresh(expiresAt: string | null): boolean {
  if (!expiresAt) {
    return false;
  }

  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return false;
  }

  return expiresAtMs <= Date.now() + TOKEN_REFRESH_BUFFER_SECONDS * 1000;
}

export async function saveShopifyOAuthTokens(input: {
  tenantId: string;
  shopDomain: string;
  tokens: ShopifyOAuthTokenResponse;
}): Promise<void> {
  const serviceClient = createServiceClient();
  const { error } = await serviceClient.from('tenant_integrations').upsert(
    {
      tenant_id: input.tenantId,
      provider: 'shopify',
      shopify_shop_domain: input.shopDomain,
      shopify_admin_token_ciphertext: encryptTenantSecret(input.tokens.accessToken),
      shopify_token_expires_at: input.tokens.expiresAt,
      shopify_refresh_token_ciphertext: input.tokens.refreshToken
        ? encryptTenantSecret(input.tokens.refreshToken)
        : null,
      shopify_refresh_token_expires_at: input.tokens.refreshTokenExpiresAt,
      is_active: true,
    },
    { onConflict: 'tenant_id,provider' },
  );

  if (error) {
    throw new Error('Unable to save the Shopify OAuth integration.');
  }
}

export async function completeShopifyOAuthConnection(input: {
  tenantId: string;
  shopDomain: string;
  code: string;
}): Promise<{ shopDomain: string }> {
  const { verifyShopifyAdminCredentials } = await import('@/lib/catalog/shopify-admin');
  const tokens = await exchangeShopifyOAuthCode(input.shopDomain, input.code);
  const identity = await verifyShopifyAdminCredentials({
    shopDomain: input.shopDomain,
    adminToken: tokens.accessToken,
  });

  if (identity.myshopifyDomain !== input.shopDomain) {
    throw new Error(`Shopify authorized ${identity.myshopifyDomain}, not ${input.shopDomain}.`);
  }

  const grantedScopes = tokens.scope
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
  if (!grantedScopes.includes('read_products')) {
    throw new Error('Shopify did not grant the read_products scope.');
  }

  await saveShopifyOAuthTokens({
    tenantId: input.tenantId,
    shopDomain: input.shopDomain,
    tokens,
  });

  return { shopDomain: input.shopDomain };
}

export function buildShopifyOAuthRedirectUrl(
  returnTo: string,
  outcome: 'connected' | 'error',
  message?: string,
): string {
  const url = new URL(readSafeReturnTo(returnTo), 'http://local.test');
  url.searchParams.set('shopify', outcome);
  if (message) {
    url.searchParams.set('message', message);
  }

  return `${url.pathname}${url.search}`;
}
