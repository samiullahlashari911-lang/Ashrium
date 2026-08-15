import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  Database,
  GarmentCadProfileInsert,
  GarmentCadProfileRow,
  GarmentCadProfileUpdate,
} from '@/types/database';

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
