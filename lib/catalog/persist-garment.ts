import type { SupabaseClient } from '@supabase/supabase-js';

import { gradeRestLengthSet } from '@/lib/catalog/laplacian-grade';
import { writeRestLengthMesh } from '@/lib/catalog/rest-length-store';
import type { Database, GarmentCadProfileInsert, Json } from '@/types/database';
import type { CatalogGarmentDraft } from '@/types/garment';

function compositionJson(draft: CatalogGarmentDraft): Json | null {
  if (!draft.composition) {
    return null;
  }

  return { ...draft.composition };
}

export async function persistCatalogGarment(
  supabase: SupabaseClient<Database, 'public'>,
  tenantId: string,
  draft: CatalogGarmentDraft,
  profileId?: string,
): Promise<{ garmentId: string; created: boolean }> {
  const profilePayload: GarmentCadProfileInsert = {
    tenant_id: tenantId,
    sku: draft.sku,
    name: draft.name,
    tensile_stiffness: draft.mechanical.tensileStiffness,
    bending_rigidity: draft.mechanical.bendingRigidity,
    shear_stiffness: draft.mechanical.shearStiffness,
    area_density: draft.mechanical.areaDensity,
    cad_pattern_url: draft.cadPatternUrl,
    category: draft.category,
    composition: compositionJson(draft),
    gsm: draft.gsm,
    ingest_confidence: draft.ingestConfidence,
    ingest_tier: draft.ingestTier,
    mode: draft.mode,
    approximate_fit: draft.approximateFit,
  };

  let garmentId = profileId ?? '';
  let created = false;

  if (profileId) {
    const { error } = await supabase
      .from('garment_cad_profiles')
      .update(profilePayload)
      .eq('id', profileId)
      .eq('tenant_id', tenantId);

    if (error) {
      throw new Error(error.message);
    }
  } else {
    const { data: existing } = await supabase
      .from('garment_cad_profiles')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('sku', draft.sku)
      .maybeSingle();

    const { data, error } = await supabase
      .from('garment_cad_profiles')
      .upsert(profilePayload, { onConflict: 'tenant_id,sku' })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? 'Unable to upsert garment profile.');
    }

    garmentId = data.id;
    created = !existing;
  }

  if (!garmentId) {
    throw new Error('Unable to resolve garment profile id.');
  }

  const meshes =
    draft.sizeVariants.length > 0
      ? gradeRestLengthSet(draft.category, draft.sizeVariants)
      : [];
  const restPaths = new Map<string, string>();

  for (const mesh of meshes) {
    try {
      const path = await writeRestLengthMesh(tenantId, garmentId, mesh);
      restPaths.set(mesh.sizeCode, path);
    } catch {
      // Measurements still persist; Phase 4 reads rest_length_path when present.
    }
  }

  const { data: existingVariants, error: existingError } = await supabase
    .from('garment_size_variants')
    .select('id, size_code')
    .eq('tenant_id', tenantId)
    .eq('garment_id', garmentId);

  if (existingError) {
    throw new Error(existingError.message);
  }

  const keepCodes = new Set(draft.sizeVariants.map((variant) => variant.sizeCode));
  const extraIds = (existingVariants ?? [])
    .filter((row) => !keepCodes.has(row.size_code))
    .map((row) => row.id);

  if (extraIds.length > 0) {
    const { error } = await supabase.from('garment_size_variants').delete().in('id', extraIds);
    if (error) {
      throw new Error(error.message);
    }
  }

  for (const variant of draft.sizeVariants) {
    const { error } = await supabase.from('garment_size_variants').upsert(
      {
        tenant_id: tenantId,
        garment_id: garmentId,
        size_code: variant.sizeCode,
        chest_cm: variant.chestCm,
        waist_cm: variant.waistCm,
        hip_cm: variant.hipCm,
        length_cm: variant.lengthCm,
        rest_length_path: restPaths.get(variant.sizeCode) ?? null,
        external_sku: variant.externalSku,
      },
      { onConflict: 'garment_id,size_code' },
    );

    if (error) {
      throw new Error(error.message);
    }
  }

  return { garmentId, created };
}
