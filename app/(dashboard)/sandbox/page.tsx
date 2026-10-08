import { redirect } from 'next/navigation';

import { StorefrontSandbox, type SandboxGarmentOption } from '@/app/(dashboard)/sandbox/storefront-sandbox';
import { inspectModalRuntimeConfig } from '@/lib/ml/gpu';
import { listGarmentProfiles } from '@/lib/server/garments';
import { createWidgetEmbedToken } from '@/lib/server/widget-embed';
import { getCurrentTenantId } from '@/lib/supabase/tenant';
import { readGarmentIngestMode, readGarmentIngestTier } from '@/types/garment';

export const dynamic = 'force-dynamic';

export default async function SandboxPage() {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    redirect('/sign-in');
  }

  const items = await listGarmentProfiles();
  const garments: SandboxGarmentOption[] = items.map((item) => ({
    sku: item.profile.sku,
    name: item.profile.name,
    mode: readGarmentIngestMode(item.profile.mode),
    ingestTier: readGarmentIngestTier(item.profile.ingest_tier),
    approximateFit: item.profile.approximate_fit,
    imageUrl: item.profile.cad_pattern_url,
    printQaPassed: item.profile.print_qa_passed === true,
  }));

  return (
    <StorefrontSandbox
      tenantId={tenantId}
      token={createWidgetEmbedToken(tenantId)}
      gpu={inspectModalRuntimeConfig()}
      garments={garments}
    />
  );
}
