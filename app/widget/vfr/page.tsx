import { createServiceClient } from '@/lib/supabase/service';
import { fetchWidgetGarmentProfile } from '@/lib/supabase/garment-profiles';
import { verifyWidgetEmbedToken } from '@/lib/server/widget-embed';
import type { ViewportConfig } from '@/types/graphics';
import { WidgetPreviewClient } from '@/app/widget/vfr/widget-preview-client';

interface WidgetVfrPageProps {
  searchParams: Promise<{
    token?: string;
  }>;
}

export default async function WidgetVfrPage({ searchParams }: WidgetVfrPageProps) {
  const params = await searchParams;
  const token = params.token?.trim();
  const claims = token ? verifyWidgetEmbedToken(token) : null;

  if (!claims) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-sm text-red-300">
        Invalid or expired widget token.
      </main>
    );
  }

  const supabase = createServiceClient();
  const garment = await fetchWidgetGarmentProfile(supabase, claims.tenantId, claims.sku);

  if (!garment) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-sm text-slate-300">
        No CAD garment profile found for this tenant.
      </main>
    );
  }

  const initialConfig: ViewportConfig = {
    showHeatmap: false,
    showWireframe: false,
    autoRotate: true,
  };

  return (
    <WidgetPreviewClient
      garment={{
        cadPatternUrl: garment.cad_pattern_url ?? 'https://placehold.co/512x512/1e293b/e2e8f0?text=Fabric',
        tensileStiffness: garment.tensile_stiffness,
        bendingRigidity: garment.bending_rigidity,
        shearStiffness: garment.shear_stiffness,
        areaDensity: garment.area_density,
      }}
      initialConfig={initialConfig}
    />
  );
}
