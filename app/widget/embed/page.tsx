import { headers } from 'next/headers';

import { StorefrontViewport } from '@/components/widget/StorefrontViewport';
import { fetchTenantGarmentProfiles } from '@/lib/supabase/garment-profiles';
import { createServiceClient } from '@/lib/supabase/service';
import { verifyWidgetEmbedToken } from '@/lib/server/widget-embed';

interface WidgetEmbedPageProps {
  searchParams: Promise<{
    parent_origin?: string;
    sku?: string;
    token?: string;
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

const DEVELOPMENT_SANDBOX_GARMENTS = [
  {
    sku: 'SKU-DENIM-001',
    cadPatternUrl: 'https://placehold.co/512x512/1e293b/e2e8f0?text=Structured+Denim',
    tensileStiffness: 190,
    bendingRigidity: 0.16,
    shearStiffness: 125,
    areaDensity: 0.42,
  },
  {
    sku: 'SKU-COTTON-002',
    cadPatternUrl: 'https://placehold.co/512x512/1e293b/e2e8f0?text=Essential+Cotton',
    tensileStiffness: 75,
    bendingRigidity: 0.03,
    shearStiffness: 45,
    areaDensity: 0.18,
  },
  {
    sku: 'SKU-KNIT-003',
    cadPatternUrl: 'https://placehold.co/512x512/1e293b/e2e8f0?text=Merino+Knit',
    tensileStiffness: 52,
    bendingRigidity: 0.02,
    shearStiffness: 36,
    areaDensity: 0.24,
  },
];

function renderEmbedError(message: string): React.JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-center text-sm text-slate-300">
      {message}
    </main>
  );
}

export default async function WidgetEmbedPage({
  searchParams,
}: WidgetEmbedPageProps): Promise<React.JSX.Element> {
  const params = await searchParams;
  const claims = params.token?.trim() ? verifyWidgetEmbedToken(params.token.trim()) : null;
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
    .select('allowed_domains')
    .eq('id', claims.tenantId)
    .maybeSingle();

  if (merchantError || !merchant || tenantError || !tenant) {
    return renderEmbedError('Widget merchant configuration is unavailable.');
  }

  const configuredOrigins = tenant.allowed_domains
    .map(merchantDomainOrigin)
    .filter((origin): origin is string => origin !== null);
  const trustedOrigins = configuredOrigins.length > 0
    ? configuredOrigins
    : [merchantDomainOrigin(merchant.domain)].filter((origin): origin is string => origin !== null);
  const isDevelopment = process.env.NODE_ENV === 'development';

  if (
    !isDevelopment
    && (
      !trustedOrigins.includes(parentOrigin)
      || !referrerOrigin
      || !trustedOrigins.includes(referrerOrigin)
    )
  ) {
    return renderEmbedError('This widget is not authorized for the current storefront.');
  }

  const allGarments = await fetchTenantGarmentProfiles(serviceClient, claims.tenantId);
  const scopedGarments = claims.sku
    ? allGarments.filter((garment) => garment.sku === claims.sku)
    : allGarments;
  const configuredGarments = scopedGarments.map((garment) => ({
    sku: garment.sku,
    cadPatternUrl:
      garment.cad_pattern_url
      ?? 'https://placehold.co/512x512/1e293b/e2e8f0?text=Fabric',
    tensileStiffness: garment.tensile_stiffness,
    bendingRigidity: garment.bending_rigidity,
    shearStiffness: garment.shear_stiffness,
    areaDensity: garment.area_density,
  }));
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
    />
  );
}
