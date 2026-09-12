import { headers } from 'next/headers';

import { StorefrontViewport } from '@/components/widget/StorefrontViewport';
import {
  fetchTenantGarmentProfiles,
  fetchTenantSizeVariants,
  resolveWidgetGarment,
  toStorefrontGarment,
} from '@/lib/supabase/garment-profiles';
import { createServiceClient } from '@/lib/supabase/service';
import { trustedStorefrontOrigins } from '@/lib/server/storefront-allowlist';
import { verifyWidgetEmbedToken } from '@/lib/server/widget-embed';
import { isWidgetEmbedParentAuthorized } from '@/lib/widget/embed-origin';
import type { StorefrontGarment } from '@/types/garment';

interface WidgetEmbedPageProps {
  searchParams: Promise<{
    parent_origin?: string;
    sku?: string;
    handle?: string;
    token?: string;
    allow_gallery?: string;
  }>;
}

function normalizeOrigin(value: string): string | null {
  try {
    const origin = new URL(value).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

const DEVELOPMENT_SANDBOX_GARMENTS: StorefrontGarment[] = [
  {
    sku: 'SKU-DENIM-001',
    name: 'Structured Denim',
    category: 'pant',
    ingestConfidence: null,
    ingestTier: null,
    approximateFit: true,
    albedoUrl: null,
    printQaPassed: false,
    sizeVariants: [],
  },
  {
    sku: 'SKU-COTTON-002',
    name: 'Essential Cotton Tee',
    category: 'tee',
    ingestConfidence: null,
    ingestTier: null,
    approximateFit: true,
    albedoUrl: null,
    printQaPassed: false,
    sizeVariants: [],
  },
  {
    sku: 'SKU-KNIT-003',
    name: 'Merino Knit',
    category: 'tee',
    ingestConfidence: null,
    ingestTier: null,
    approximateFit: true,
    albedoUrl: null,
    printQaPassed: false,
    sizeVariants: [],
  },
];

function renderEmbedError(message: string): React.JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center bg-obsidian-canvas p-6 text-center text-sm text-obsidian-muted">
      {message}
    </main>
  );
}

export default async function WidgetEmbedPage({
  searchParams,
}: WidgetEmbedPageProps): Promise<React.JSX.Element> {
  const params = await searchParams;
  const embedToken = params.token?.trim() ?? '';
  const claims = embedToken ? verifyWidgetEmbedToken(embedToken) : null;
  const parentOrigin = params.parent_origin ? normalizeOrigin(params.parent_origin) : null;
  const requestHeaders = await headers();
  const referrer = requestHeaders.get('referer');
  const referrerOrigin = referrer ? normalizeOrigin(referrer) : null;

  if (!claims || !parentOrigin) {
    return renderEmbedError('Invalid or expired widget embed.');
  }

  const serviceClient = createServiceClient();
  const { data: merchant, error: merchantError } = await serviceClient
    .from('merchants')
    .select('domain')
    .eq('id', claims.tenantId)
    .maybeSingle();
  const { data: tenant, error: tenantError } = await serviceClient
    .from('tenants')
    .select('allowed_domains, status')
    .eq('id', claims.tenantId)
    .maybeSingle();

  if (merchantError || !merchant || tenantError || !tenant || tenant.status !== 'active') {
    return renderEmbedError('Widget merchant configuration is unavailable.');
  }

  const { data: integration } = await serviceClient
    .from('tenant_integrations')
    .select('shopify_shop_domain')
    .eq('tenant_id', claims.tenantId)
    .eq('provider', 'shopify')
    .eq('is_active', true)
    .maybeSingle();

  const trustedOrigins = trustedStorefrontOrigins({
    allowedDomains: tenant.allowed_domains,
    merchantDomain: merchant.domain,
    shopifyShopDomain: integration?.shopify_shop_domain,
  });
  const isDevelopment = process.env.NODE_ENV === 'development';
  const requestHost = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  const appOrigin = requestHost ? normalizeOrigin(`https://${requestHost}`) : null;
  const hostMatchesParent = parentOrigin !== null && appOrigin !== null && parentOrigin === appOrigin;
  const allowGallery = params.allow_gallery === '1' && (isDevelopment || hostMatchesParent);

  if (
    !isWidgetEmbedParentAuthorized({
      isDevelopment,
      parentOrigin,
      referrerOrigin,
      appOrigin,
      trustedOrigins,
    })
  ) {
    return renderEmbedError('This widget is not authorized for the current storefront.');
  }

  const [allGarments, allVariants] = await Promise.all([
    fetchTenantGarmentProfiles(serviceClient, claims.tenantId),
    fetchTenantSizeVariants(serviceClient, claims.tenantId),
  ]);
  const requestedHandle = params.handle?.trim();
  const requestedSku = claims.sku ?? params.sku?.trim();
  const resolved = requestedHandle || requestedSku
    ? await resolveWidgetGarment(serviceClient, claims.tenantId, {
      handle: requestedHandle,
      sku: requestedSku,
    })
    : null;

  if ((requestedHandle || requestedSku) && !resolved) {
    return renderEmbedError('Try On is not available for this item.');
  }

  const scopedGarments = resolved
    ? [resolved.garment]
    : claims.sku
      ? allGarments.filter((garment) => garment.sku === claims.sku)
      : allGarments;
  const configuredGarments = scopedGarments.map((garment) =>
    toStorefrontGarment(
      garment,
      resolved
        ? resolved.variants
        : allVariants.filter((variant) => variant.garment_id === garment.id),
    ),
  );
  const garments = configuredGarments.length > 0
    ? configuredGarments
    : isDevelopment && !claims.sku && !requestedHandle && !requestedSku
      ? DEVELOPMENT_SANDBOX_GARMENTS
      : [];
  const initialSku = resolved?.garment.sku
    ?? (requestedSku && garments.some((garment) => garment.sku === requestedSku)
      ? requestedSku
      : garments[0]?.sku);

  if (!initialSku) {
    return renderEmbedError('Try On is not available for this item.');
  }

  return (
    <StorefrontViewport
      garments={garments}
      initialSku={initialSku}
      targetOrigin={isDevelopment ? '*' : parentOrigin}
      tenantId={claims.tenantId}
      embedToken={embedToken}
      allowGallery={allowGallery}
    />
  );
}
