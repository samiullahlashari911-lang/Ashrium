import { after } from 'next/server';

import type { SupabaseClient } from '@supabase/supabase-js';

import { patternProductText, shouldDispatchPattern } from '@/lib/catalog/pattern-ingest';
import { evaluatePrintAlbedoUrl } from '@/lib/catalog/print-qa';
import { writeRestLengthMesh } from '@/lib/catalog/rest-length-store';
import { detectUnsupportedGeometry } from '@/lib/catalog/unsupported-geometry';
import {
  runPatternPrediction,
  rewritePatternCogError,
  type PatternIngestResult,
} from '@/lib/ml/replicate';
import type { Database, GarmentCadProfileInsert, Json } from '@/types/database';
import type { CatalogGarmentDraft, RestLengthMesh } from '@/types/garment';

function compositionJson(draft: CatalogGarmentDraft): Json | null {
  if (!draft.composition) {
    return null;
  }

  return { ...draft.composition };
}

function scheduleFollowUp(work: () => Promise<void>): void {
  try {
    after(() => {
      void work();
    });
  } catch {
    // Charts are already saved; GarmentCode can retry on the next sync.
  }
}

async function gradeWithGarmentCode(draft: CatalogGarmentDraft): Promise<{
  meshes: RestLengthMesh[];
  approximateFit: boolean;
}> {
  const unsupported = detectUnsupportedGeometry({
    category: draft.category,
    title: draft.name,
    description: draft.ingestCorpus ?? '',
    composition: draft.composition,
  });
  if (unsupported || !shouldDispatchPattern(draft)) {
    return { meshes: [], approximateFit: true };
  }

  let result: PatternIngestResult;
  try {
    result = await runPatternPrediction({
      category: draft.category,
      productText: patternProductText(draft),
      sizeVariants: draft.sizeVariants.map((variant) => ({
        sizeCode: variant.sizeCode,
        chestCm: variant.chestCm ?? 0,
        waistCm: variant.waistCm ?? 0,
        hipCm: variant.hipCm ?? 0,
        lengthCm: variant.lengthCm ?? 0,
      })),
    });
  } catch (error) {
    throw rewritePatternCogError(error);
  }

  if (result.status !== 'ok' || result.meshes.length === 0) {
    return { meshes: [], approximateFit: true };
  }

  const byCode = new Map(result.meshes.map((mesh) => [mesh.sizeCode, mesh]));
  const complete = draft.sizeVariants.every((variant) => byCode.has(variant.sizeCode));
  if (!complete) {
    return { meshes: [], approximateFit: true };
  }

  return { meshes: result.meshes, approximateFit: draft.approximateFit };
}

async function writeSizeVariants(
  supabase: SupabaseClient<Database, 'public'>,
  tenantId: string,
  garmentId: string,
  draft: CatalogGarmentDraft,
  restPaths: Map<string, string>,
): Promise<void> {
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
}

async function attachGarmentCodePattern(
  supabase: SupabaseClient<Database, 'public'>,
  tenantId: string,
  garmentId: string,
  draft: CatalogGarmentDraft,
): Promise<void> {
  const graded = await gradeWithGarmentCode(draft);
  const restPaths = new Map<string, string>();
  for (const mesh of graded.meshes) {
    const path = await writeRestLengthMesh(tenantId, garmentId, mesh);
    restPaths.set(mesh.sizeCode, path);
  }

  if (restPaths.size === 0 && !graded.approximateFit) {
    return;
  }

  if (graded.approximateFit) {
    await supabase
      .from('garment_cad_profiles')
      .update({ approximate_fit: true })
      .eq('id', garmentId)
      .eq('tenant_id', tenantId);
  }

  for (const variant of draft.sizeVariants) {
    const path = restPaths.get(variant.sizeCode);
    if (!path) {
      continue;
    }

    await supabase
      .from('garment_size_variants')
      .update({ rest_length_path: path })
      .eq('tenant_id', tenantId)
      .eq('garment_id', garmentId)
      .eq('size_code', variant.sizeCode);
  }
}

export async function persistCatalogGarment(
  supabase: SupabaseClient<Database, 'public'>,
  tenantId: string,
  draft: CatalogGarmentDraft,
  profileId?: string,
): Promise<{ garmentId: string; created: boolean }> {
  if (!profileId) {
    const { data: existing } = await supabase
      .from('garment_cad_profiles')
      .select('id, mode')
      .eq('tenant_id', tenantId)
      .eq('sku', draft.sku)
      .maybeSingle();

    if (
      existing
      && (existing.mode === 'A' || existing.mode === 'B')
      && draft.mode === 'C'
    ) {
      return { garmentId: existing.id, created: false };
    }
  }

  const printQa = await evaluatePrintAlbedoUrl(draft.cadPatternUrl);
  const approximateFit = draft.approximateFit || !printQa.passed;

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
    approximate_fit: approximateFit,
    print_qa_passed: printQa.passed,
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

  await writeSizeVariants(supabase, tenantId, garmentId, draft, new Map());

  if (shouldDispatchPattern(draft)) {
    const id = garmentId;
    scheduleFollowUp(async () => {
      try {
        await attachGarmentCodePattern(supabase, tenantId, id, draft);
      } catch {
        await supabase
          .from('garment_cad_profiles')
          .update({ approximate_fit: true })
          .eq('id', id)
          .eq('tenant_id', tenantId);
      }
    });
  }

  return { garmentId, created };
}
