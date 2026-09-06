import { headers } from 'next/headers';

import { StorefrontViewport } from '@/components/widget/StorefrontViewport';
import {
  fetchTenantGarmentProfiles,
  fetchTenantSizeVariants,
  toStorefrontGarment,
} from '@/lib/supabase/garment-profiles';
import { createServiceClient } from '@/lib/supabase/service';
import { verifyWidgetEmbedToken } from '@/lib/server/widget-embed';
import { isWidgetEmbedParentAuthorized } from '@/lib/widget/embed-origin';
import type { StorefrontGarment } from '@/types/garment';

interface WidgetEmbedPageProps {
  searchParams: Promise<{
    parent_origin?: string;
    sku?: string;
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

function merchantDomainOrigin(domain: string): string | null {
  const trimmedDomain = domain.trim();
  const withProtocol = /^https?:\/\//i.test(trimmedDomain)
    ? trimmedDomain
    : `https://${trimmedDomain}`;

  return normalizeOrigin(withProtocol);
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

  const configuredOrigins = tenant.allowed_domains
    .map(merchantDomainOrigin)
    .filter((origin): origin is string => origin !== null);
  const trustedOrigins = configuredOrigins.length > 0
    ? configuredOrigins
    : [merchantDomainOrigin(merchant.domain)].filter((origin): origin is string => origin !== null);
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
  const scopedGarments = claims.sku
    ? allGarments.filter((garment) => garment.sku === claims.sku)
    : allGarments;
  const configuredGarments = scopedGarments.map((garment) =>
    toStorefrontGarment(
      garment,
      allVariants.filter((variant) => variant.garment_id === garment.id),
    ),
  );
  const garments = configuredGarments.length > 0
    ? configuredGarments
    : isDevelopment && !claims.sku
      ? DEVELOPMENT_SANDBOX_GARMENTS
      : [];
  const requestedSku = claims.sku ?? params.sku?.trim();
  const initialSku = requestedSku && garments.some((garment) => garment.sku === requestedSku)
    ? requestedSku
    : garments[0]?.sku;

  if (!initialSku) {
    return renderEmbedError('No CAD garment profile is available for this widget.');
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
