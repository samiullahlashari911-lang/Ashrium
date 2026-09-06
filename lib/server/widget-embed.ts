import { createHmac, timingSafeEqual } from 'node:crypto';

const TOKEN_TTL_SECONDS = 15 * 60;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface WidgetEmbedClaims {
  exp: number;
  sku?: string;
  tenantId: string;
}

export interface WidgetEmbedConfig {
  scriptUrl: string;
}

function getWidgetEmbedSecret(): string {
  const secret = process.env.WIDGET_EMBED_SIGNING_SECRET?.trim();

  if (!secret || secret.length < 32) {
    throw new Error('WIDGET_EMBED_SIGNING_SECRET must be at least 32 characters.');
  }

  return secret;
}

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

function sign(value: string): string {
  return createHmac('sha256', getWidgetEmbedSecret()).update(value).digest('base64url');
}

function isWidgetEmbedClaims(value: unknown): value is WidgetEmbedClaims {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const claims = value as Record<string, unknown>;

  return (
    typeof claims.exp === 'number' &&
    Number.isSafeInteger(claims.exp) &&
    typeof claims.tenantId === 'string' &&
    UUID_PATTERN.test(claims.tenantId) &&
    (claims.sku === undefined || (typeof claims.sku === 'string' && claims.sku.length > 0))
  );
}

export function createWidgetEmbedToken(tenantId: string, sku?: string): string {
  if (!UUID_PATTERN.test(tenantId)) {
    throw new Error('A valid tenant ID is required to create a widget embed token.');
  }

  const claims: WidgetEmbedClaims = {
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    ...(sku ? { sku } : {}),
    tenantId,
  };
  const encodedClaims = encodeBase64Url(JSON.stringify(claims));

  return `${encodedClaims}.${sign(encodedClaims)}`;
}

export function verifyWidgetEmbedToken(token: string): WidgetEmbedClaims | null {
  const [encodedClaims, providedSignature, ...extraParts] = token.split('.');

  if (!encodedClaims || !providedSignature || extraParts.length > 0) {
    return null;
  }

  const expectedSignature = sign(encodedClaims);
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return null;
  }

  const serializedClaims = decodeBase64Url(encodedClaims);
  if (!serializedClaims) {
    return null;
  }

  try {
    const claims: unknown = JSON.parse(serializedClaims);

    if (!isWidgetEmbedClaims(claims) || claims.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }

    return claims;
  } catch {
    return null;
  }
}

export async function createWidgetEmbedConfig(origin: string, sku?: string): Promise<WidgetEmbedConfig> {
  const { requireCurrentTenantId } = await import('@/lib/supabase/tenant');
  const tenantId = await requireCurrentTenantId();
  const token = createWidgetEmbedToken(tenantId, sku?.trim() || undefined);
  const params = new URLSearchParams({ token });

  return {
    scriptUrl: `${origin}/api/v1/widget/script?${params.toString()}`,
  };
}
