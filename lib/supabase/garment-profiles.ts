import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  Database,
  GarmentCadProfileInsert,
  GarmentCadProfileRow,
  GarmentCadProfileUpdate,
  GarmentSizeVariantRow,
} from '@/types/database';
import {
  readGarmentCategory,
  readGarmentIngestTier,
  type StorefrontGarment,
  type StorefrontSizeVariant,
} from '@/types/garment';

export async function fetchTenantGarmentProfiles(
  supabase: SupabaseClient<Database, 'public'>,
  tenantId: string,
): Promise<GarmentCadProfileRow[]> {
  const { data, error } = await supabase
    .from('garment_cad_profiles')
    .select()
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function insertGarmentProfile(
  supabase: SupabaseClient<Database, 'public'>,
  payload: GarmentCadProfileInsert,
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.from('garment_cad_profiles').insert(payload);
  return { error };
}

export async function updateGarmentProfileRow(
  supabase: SupabaseClient<Database, 'public'>,
  profileId: string,
  tenantId: string,
  payload: GarmentCadProfileUpdate,
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase
    .from('garment_cad_profiles')
    .update(payload)
    .eq('id', profileId)
    .eq('tenant_id', tenantId);
  return { error };
}

export async function deleteGarmentProfileRow(
  supabase: SupabaseClient<Database, 'public'>,
  profileId: string,
  tenantId: string,
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase
    .from('garment_cad_profiles')
    .delete()
    .eq('id', profileId)
    .eq('tenant_id', tenantId);
  return { error };
}

export async function fetchWidgetGarmentProfile(
  supabase: SupabaseClient<Database, 'public'>,
  tenantId: string,
  sku?: string,
): Promise<GarmentCadProfileRow | null> {
  if (sku) {
    const { data, error } = await supabase
      .from('garment_cad_profiles')
      .select()
      .eq('tenant_id', tenantId)
      .eq('sku', sku)
      .maybeSingle();

    if (error) {
      return null;
    }

    return data;
  }

  const { data, error } = await supabase
    .from('garment_cad_profiles')
    .select()
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return null;
  }

  return data;
}

export async function fetchTenantSizeVariants(
  supabase: SupabaseClient<Database, 'public'>,
  tenantId: string,
): Promise<GarmentSizeVariantRow[]> {
  const { data, error } = await supabase
    .from('garment_size_variants')
    .select()
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function fetchGarmentBySkuWithVariants(
  supabase: SupabaseClient<Database, 'public'>,
  tenantId: string,
  sku: string,
): Promise<{ garment: GarmentCadProfileRow; variants: GarmentSizeVariantRow[] } | null> {
  const { data: bySku, error } = await supabase
    .from('garment_cad_profiles')
    .select()
    .eq('tenant_id', tenantId)
    .eq('sku', sku)
    .maybeSingle();

  let garment = error ? null : bySku;

  if (!garment) {
    const { data: byExternal } = await supabase
      .from('garment_size_variants')
      .select('garment_id')
      .eq('tenant_id', tenantId)
      .eq('external_sku', sku)
      .maybeSingle();

    if (!byExternal) {
      return null;
    }

    const { data: parent } = await supabase
      .from('garment_cad_profiles')
      .select()
      .eq('tenant_id', tenantId)
      .eq('id', byExternal.garment_id)
      .maybeSingle();

    garment = parent;
  }

  if (!garment) {
    return null;
  }

  const { data: variants, error: variantError } = await supabase
    .from('garment_size_variants')
    .select()
    .eq('tenant_id', tenantId)
    .eq('garment_id', garment.id)
    .order('created_at', { ascending: true });

  if (variantError) {
    return { garment, variants: [] };
  }

  return { garment, variants: variants ?? [] };
}

export async function resolveWidgetGarment(
  supabase: SupabaseClient<Database, 'public'>,
  tenantId: string,
  input: { handle?: string; sku?: string },
): Promise<{ garment: GarmentCadProfileRow; variants: GarmentSizeVariantRow[] } | null> {
  const handle = input.handle?.trim().toLowerCase();
  const sku = input.sku?.trim();

  if (sku) {
    const bySku = await fetchGarmentBySkuWithVariants(supabase, tenantId, sku);
    if (bySku) {
      return bySku;
    }
  }

  if (!handle) {
    return null;
  }

  const profiles = await fetchTenantGarmentProfiles(supabase, tenantId);
  const matches = profiles.filter((profile) => {
    const skuValue = profile.sku.trim().toLowerCase();
    return skuValue === handle || skuValue.startsWith(`${handle}-`);
  });
  if (matches.length === 0) {
    return null;
  }

  const withVariants = await Promise.all(
    matches.map(async (garment) => {
      const { data } = await supabase
        .from('garment_size_variants')
        .select()
        .eq('tenant_id', tenantId)
        .eq('garment_id', garment.id);
      return { garment, variants: data ?? [] };
    }),
  );

  if (sku) {
    const withExternal = withVariants.find((entry) =>
      entry.variants.some((variant) => variant.external_sku === sku),
    );
    if (withExternal) {
      return withExternal;
    }
  }

  return withVariants[0] ?? null;
}

export async function fetchTenantGarmentsWithVariants(
  supabase: SupabaseClient<Database, 'public'>,
  tenantId: string,
): Promise<Array<{ profile: GarmentCadProfileRow; variants: GarmentSizeVariantRow[] }>> {
  const profiles = await fetchTenantGarmentProfiles(supabase, tenantId);
  const variants = await fetchTenantSizeVariants(supabase, tenantId);
  const byGarment = new Map<string, GarmentSizeVariantRow[]>();

  for (const variant of variants) {
    const list = byGarment.get(variant.garment_id) ?? [];
    list.push(variant);
    byGarment.set(variant.garment_id, list);
  }

  return profiles.map((profile) => ({
    profile,
    variants: byGarment.get(profile.id) ?? [],
  }));
}

export function toStorefrontSizeVariant(row: GarmentSizeVariantRow): StorefrontSizeVariant {
  return {
    id: row.id,
    sizeCode: row.size_code,
    chestCm: row.chest_cm ?? 0,
    waistCm: row.waist_cm ?? 0,
    hipCm: row.hip_cm ?? 0,
    lengthCm: row.length_cm ?? 0,
  };
}

export function toStorefrontGarment(
  row: GarmentCadProfileRow,
  variants: readonly GarmentSizeVariantRow[],
): StorefrontGarment {
  const printQaPassed = row.print_qa_passed && Boolean(row.cad_pattern_url);
  return {
    sku: row.sku,
    name: row.name,
    category: readGarmentCategory(row.category),
    ingestConfidence: row.ingest_confidence,
    ingestTier: readGarmentIngestTier(row.ingest_tier),
    approximateFit: row.approximate_fit || !printQaPassed,
    albedoUrl: printQaPassed ? row.cad_pattern_url : null,
    printQaPassed,
    sizeVariants: variants.map(toStorefrontSizeVariant),
  };
}
