'use server';

import { revalidatePath } from 'next/cache';

import {
  deleteGarmentProfileRow,
  fetchTenantGarmentProfiles,
  insertGarmentProfile,
  updateGarmentProfileRow,
} from '@/lib/supabase/garment-profiles';
import { createClient } from '@/lib/supabase/server';
import { requireCurrentTenantId } from '@/lib/supabase/tenant';
import type { GarmentCadProfileInsert, GarmentCadProfileRow, GarmentCadProfileUpdate } from '@/types/database';
import type { GarmentMechanicalProperties } from '@/types/garment';

export interface GarmentFormInput extends GarmentMechanicalProperties {
  sku: string;
  name: string;
  cadPatternUrl: string;
}

export interface GarmentActionResult {
  success: boolean;
  message: string;
}

const GARMENTS_PATH = '/dashboard/garments';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isPositiveFiniteNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function validateGarmentFormInput(input: GarmentFormInput): string | null {
  if (input.sku.trim().length === 0 || input.sku.trim().length > 128) {
    return 'SKU must contain between 1 and 128 characters.';
  }

  if (input.name.trim().length === 0 || input.name.trim().length > 256) {
    return 'Name must contain between 1 and 256 characters.';
  }

  if (!isHttpsUrl(input.cadPatternUrl.trim())) {
    return 'CAD pattern URL must be a valid HTTPS URL.';
  }

  const mechanicalValues = [
    input.tensileStiffness,
    input.bendingRigidity,
    input.shearStiffness,
    input.areaDensity,
  ];

  return mechanicalValues.every(isPositiveFiniteNumber)
    ? null
    : 'Mechanical properties must be finite values greater than zero.';
}

export async function listGarmentProfiles(): Promise<GarmentCadProfileRow[]> {
  const supabase = await createClient();
  const tenantId = await requireCurrentTenantId();
  return fetchTenantGarmentProfiles(supabase, tenantId);
}

export async function createGarmentProfile(
  input: GarmentFormInput,
): Promise<GarmentActionResult> {
  const validationError = validateGarmentFormInput(input);
  if (validationError) {
    return { success: false, message: validationError };
  }

  try {
    const supabase = await createClient();
    const tenantId = await requireCurrentTenantId();

    const insertPayload: GarmentCadProfileInsert = {
      tenant_id: tenantId,
      sku: input.sku.trim(),
      name: input.name.trim(),
      tensile_stiffness: input.tensileStiffness,
      bending_rigidity: input.bendingRigidity,
      shear_stiffness: input.shearStiffness,
      area_density: input.areaDensity,
      cad_pattern_url: input.cadPatternUrl.trim() || null,
    };

    const { error } = await insertGarmentProfile(supabase, insertPayload);

    if (error) {
      return { success: false, message: error.message };
    }

    revalidatePath(GARMENTS_PATH);
    return { success: true, message: 'CAD garment profile created.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create garment profile.';
    return { success: false, message };
  }
}

export async function updateGarmentProfile(
  profileId: string,
  input: GarmentFormInput,
): Promise<GarmentActionResult> {
  if (!UUID_PATTERN.test(profileId)) {
    return { success: false, message: 'Invalid garment profile ID.' };
  }

  const validationError = validateGarmentFormInput(input);
  if (validationError) {
    return { success: false, message: validationError };
  }

  try {
    const supabase = await createClient();
    const tenantId = await requireCurrentTenantId();

    const updatePayload: GarmentCadProfileUpdate = {
      sku: input.sku.trim(),
      name: input.name.trim(),
      tensile_stiffness: input.tensileStiffness,
      bending_rigidity: input.bendingRigidity,
      shear_stiffness: input.shearStiffness,
      area_density: input.areaDensity,
      cad_pattern_url: input.cadPatternUrl.trim() || null,
    };

    const { error } = await updateGarmentProfileRow(
      supabase,
      profileId,
      tenantId,
      updatePayload,
    );

    if (error) {
      return { success: false, message: error.message };
    }

    revalidatePath(GARMENTS_PATH);
    return { success: true, message: 'CAD garment profile updated.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update garment profile.';
    return { success: false, message };
  }
}

export async function deleteGarmentProfile(profileId: string): Promise<GarmentActionResult> {
  if (!UUID_PATTERN.test(profileId)) {
    return { success: false, message: 'Invalid garment profile ID.' };
  }

  try {
    const supabase = await createClient();
    const tenantId = await requireCurrentTenantId();

    const { error } = await deleteGarmentProfileRow(supabase, profileId, tenantId);

    if (error) {
      return { success: false, message: error.message };
    }

    revalidatePath(GARMENTS_PATH);
    return { success: true, message: 'CAD garment profile deleted.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to delete garment profile.';
    return { success: false, message };
  }
}
