'use server';

import { revalidatePath } from 'next/cache';

import { persistCatalogGarment } from '@/lib/catalog/persist-garment';
import { lookupKesProperties, mechanicalDeltaRatio } from '@/lib/catalog/kes-lookup';
import { parseCompositionText } from '@/lib/catalog/parse-product';
import {
  deleteGarmentProfileRow,
  fetchTenantGarmentsWithVariants,
} from '@/lib/supabase/garment-profiles';
import { createClient } from '@/lib/supabase/server';
import { requireCurrentTenantId } from '@/lib/supabase/tenant';
import type { GarmentWorkspaceItem } from '@/types/database';
import {
  GARMENT_CATEGORIES,
  readGarmentCategory,
  type CatalogGarmentDraft,
  type CatalogSizeVariantInput,
  type GarmentCategory,
  type GarmentMechanicalProperties,
} from '@/types/garment';

export interface GarmentSizeFormInput {
  sizeCode: string;
  chestCm: number;
  waistCm: number;
  hipCm: number;
  lengthCm: number;
  externalSku: string;
}

export interface GarmentFormInput extends GarmentMechanicalProperties {
  sku: string;
  name: string;
  cadPatternUrl: string;
  category: GarmentCategory | '';
  compositionText: string;
  gsm: number | '';
  sizeVariants: GarmentSizeFormInput[];
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

  const cadUrl = input.cadPatternUrl.trim();
  if (cadUrl.length > 0 && !isHttpsUrl(cadUrl)) {
    return 'CAD pattern URL must be a valid HTTPS URL.';
  }

  if (input.category !== '' && !GARMENT_CATEGORIES.includes(input.category)) {
    return 'Choose a valid garment category.';
  }

  if (input.gsm !== '' && (!Number.isFinite(input.gsm) || input.gsm <= 0 || input.gsm > 800)) {
    return 'GSM must be a positive fabric weight.';
  }

  const mechanicalValues = [
    input.tensileStiffness,
    input.bendingRigidity,
    input.shearStiffness,
    input.areaDensity,
  ];

  if (!mechanicalValues.every(isPositiveFiniteNumber)) {
    return 'Mechanical properties must be finite values greater than zero.';
  }

  for (const variant of input.sizeVariants) {
    if (variant.sizeCode.trim().length === 0 || variant.sizeCode.trim().length > 16) {
      return 'Each size code must contain between 1 and 16 characters.';
    }

    if (
      ![variant.chestCm, variant.waistCm, variant.hipCm, variant.lengthCm].every(
        isPositiveFiniteNumber,
      )
    ) {
      return 'Size measurements must be finite values greater than zero.';
    }
  }

  return null;
}

function toDraft(input: GarmentFormInput): CatalogGarmentDraft {
  const category: GarmentCategory = readGarmentCategory(input.category) ?? 'other';
  const composition = parseCompositionText(input.compositionText);
  const gsm = input.gsm === '' ? null : input.gsm;
  const formMechanical: GarmentMechanicalProperties = {
    tensileStiffness: input.tensileStiffness,
    bendingRigidity: input.bendingRigidity,
    shearStiffness: input.shearStiffness,
    areaDensity: input.areaDensity,
  };
  const kesMechanical = lookupKesProperties(composition, gsm, category);
  const sizeVariants: CatalogSizeVariantInput[] = input.sizeVariants.map((variant) => ({
    sizeCode: variant.sizeCode.trim().toUpperCase(),
    chestCm: variant.chestCm,
    waistCm: variant.waistCm,
    hipCm: variant.hipCm,
    lengthCm: variant.lengthCm,
    externalSku: variant.externalSku.trim().slice(0, 128) || null,
    measurementsFromSource: true,
  }));

  const cadPatternUrl = input.cadPatternUrl.trim() || null;
  const defaultMechanical: GarmentMechanicalProperties = {
    tensileStiffness: 1,
    bendingRigidity: 0.1,
    shearStiffness: 0.5,
    areaDensity: 0.2,
  };
  const usingFormDefaults = mechanicalDeltaRatio(formMechanical, defaultMechanical) <= 0.05;
  const explicitKesOverride =
    Boolean(composition)
    && !usingFormDefaults
    && mechanicalDeltaRatio(formMechanical, kesMechanical) > 0.05;

  if (composition && sizeVariants.length > 0 && explicitKesOverride) {
    return {
      sku: input.sku.trim(),
      name: input.name.trim(),
      category,
      composition,
      gsm,
      ingestConfidence: 0.95,
      ingestTier: 1,
      mode: 'A',
      approximateFit: false,
      mechanical: formMechanical,
      cadPatternUrl,
      sizeVariants,
    };
  }

  if (composition && sizeVariants.length > 0) {
    return {
      sku: input.sku.trim(),
      name: input.name.trim(),
      category,
      composition,
      gsm,
      ingestConfidence: sizeVariants.length >= 2 ? 0.82 : 0.74,
      ingestTier: 2,
      mode: 'B',
      approximateFit: false,
      mechanical: kesMechanical,
      cadPatternUrl,
      sizeVariants,
    };
  }

  return {
    sku: input.sku.trim(),
    name: input.name.trim(),
    category,
    composition,
    gsm,
    ingestConfidence: 0.35,
    ingestTier: 2,
    mode: 'C',
    approximateFit: true,
    mechanical: formMechanical,
    cadPatternUrl,
    sizeVariants,
  };
}

function saveMessage(draft: CatalogGarmentDraft, updated: boolean): string {
  const verb = updated ? 'updated' : 'created';
  if (draft.mode === 'A') {
    return `CAD garment profile ${verb} as Tier 1 Mode A.`;
  }

  if (draft.mode === 'B') {
    return `CAD garment profile ${verb} as Mode B (validated Tier 2). Size chart and material were mapped through the KES table.`;
  }

  return `CAD garment profile ${verb} as Mode C (approximate ingest).`;
}

export async function listGarmentProfiles(): Promise<GarmentWorkspaceItem[]> {
  const supabase = await createClient();
  const tenantId = await requireCurrentTenantId();
  return fetchTenantGarmentsWithVariants(supabase, tenantId);
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
    const draft = toDraft(input);
    await persistCatalogGarment(supabase, tenantId, draft);
    revalidatePath(GARMENTS_PATH);
    return { success: true, message: saveMessage(draft, false) };
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
    const draft = toDraft(input);
    await persistCatalogGarment(supabase, tenantId, draft, profileId);
    revalidatePath(GARMENTS_PATH);
    return { success: true, message: saveMessage(draft, true) };
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
