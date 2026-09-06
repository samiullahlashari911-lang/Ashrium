import type { SupabaseClient } from '@supabase/supabase-js';

import { GARMENT_CAD_BUCKET } from '@/lib/catalog/rest-length-store';
import {
  buildHullCollisionField,
  deformHullForParametric,
  loadAnnyHullGeometry,
} from '@/lib/graphics/anny-hull-server';
import {
  encodeSimDelta,
  isCurrentSimDelta,
  simDeltaToBase64,
} from '@/lib/graphics/meshopt-delta';
import { garmentOriginY, runXpbdOnHull } from '@/lib/graphics/xpbd-cloth';
import { matchSimulationCache } from '@/lib/fit/simulation-match';
import { recommendSize } from '@/lib/fit/size-recommend';
import type { Database } from '@/types/database';
import type { FitDrapeResolve } from '@/types/graphics';
import {
  readGarmentCategory,
  readRestLengthMesh,
  type GarmentMechanicalProperties,
} from '@/types/garment';
import {
  ANNY_TOPOLOGY_VERSION,
  MHR_TOPOLOGY_VERSION,
  readAnnyParametricVector,
  readMhrParametricVector,
  type AnnyParametricVector,
} from '@/types/hmr';
import { toStorefrontGarment } from '@/lib/supabase/garment-profiles';

export const GARMENT_SIMULATIONS_BUCKET = 'garment-simulations';
const SIMULATION_CACHE_TTL_MS = 15 * 60 * 1000;

export interface ResolveFitDrapeInput {
  supabase: SupabaseClient<Database, 'public'>;
  tenantId: string;
  jobId: string;
  sku: string;
  /** When true, run XPBD on cache miss. When false, return unavailable without blocking. */
  allowXpbd?: boolean;
}

function mechanicalFromProfile(row: {
  tensile_stiffness: number;
  bending_rigidity: number;
  shear_stiffness: number;
  area_density: number;
}): GarmentMechanicalProperties {
  return {
    tensileStiffness: row.tensile_stiffness,
    bendingRigidity: row.bending_rigidity,
    shearStiffness: row.shear_stiffness,
    areaDensity: row.area_density,
  };
}

function deltaObjectPath(tenantId: string, variantId: string, cacheId: string): string {
  return `${tenantId}/${variantId}/${cacheId}.asim`;
}

async function sweepExpiredSimulationCache(
  supabase: SupabaseClient<Database, 'public'>,
  tenantId: string,
): Promise<void> {
  const { data: expired, error } = await supabase
    .from('simulation_cache')
    .select('id, delta_storage_path, strain_storage_path')
    .eq('tenant_id', tenantId)
    .lte('expires_at', new Date().toISOString())
    .limit(100);

  if (error || !expired || expired.length === 0) {
    return;
  }

  const paths = Array.from(
    new Set(
      expired.flatMap((row) => [
        ...(row.delta_storage_path ? [row.delta_storage_path] : []),
        ...(row.strain_storage_path ? [row.strain_storage_path] : []),
      ]),
    ),
  );

  if (paths.length > 0) {
    const { error: removeError } = await supabase.storage
      .from(GARMENT_SIMULATIONS_BUCKET)
      .remove(paths);
    if (removeError) {
      return;
    }
  }

  await supabase
    .from('simulation_cache')
    .delete()
    .eq('tenant_id', tenantId)
    .in('id', expired.map((row) => row.id));
}

async function downloadDeltaBytes(
  supabase: SupabaseClient<Database, 'public'>,
  path: string,
): Promise<Uint8Array | null> {
  const { data, error } = await supabase.storage.from(GARMENT_SIMULATIONS_BUCKET).download(path);
  if (error || !data) {
    return null;
  }

  const buffer = await data.arrayBuffer();
  return new Uint8Array(buffer);
}

async function loadRestLengthMesh(
  supabase: SupabaseClient<Database, 'public'>,
  path: string | null,
): Promise<ReturnType<typeof readRestLengthMesh>> {
  if (!path) {
    return null;
  }

  const { data, error } = await supabase.storage.from(GARMENT_CAD_BUCKET).download(path);
  if (error || !data) {
    return null;
  }

  const text = await data.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  return readRestLengthMesh(parsed);
}

async function insertCacheRow(options: {
  supabase: SupabaseClient<Database, 'public'>;
  tenantId: string;
  variantId: string;
  phenotype: AnnyParametricVector['phenotype'];
  meanStrain: number;
}): Promise<string> {
  const { data, error } = await options.supabase
    .from('simulation_cache')
    .insert({
      tenant_id: options.tenantId,
      variant_id: options.variantId,
      phenotype: options.phenotype,
      mean_strain: options.meanStrain,
      topology_version: ANNY_TOPOLOGY_VERSION,
      expires_at: new Date(Date.now() + SIMULATION_CACHE_TTL_MS).toISOString(),
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Unable to insert simulation_cache row.');
  }

  return data.id;
}

/**
 * Drape resolution: cache hit → signed delta; miss → XPBD → meshopt upload → cache insert.
 * Must not block the avatar SLA: callers can set allowXpbd=false for a fast probe.
 */
export async function resolveFitDrape(input: ResolveFitDrapeInput): Promise<FitDrapeResolve> {
  const allowXpbd = input.allowXpbd ?? true;
  const { data: job, error: jobError } = await input.supabase
    .from('fit_jobs')
    .select('id, status, height_cm, parametric_result')
    .eq('id', input.jobId)
    .eq('tenant_id', input.tenantId)
    .maybeSingle();

  if (jobError || !job || job.status !== 'completed') {
    return {
      source: 'unavailable',
      similarity: null,
      xpbdCompleted: false,
      topologyVersion: ANNY_TOPOLOGY_VERSION,
      meanStrain: null,
      payloadBase64: null,
    };
  }

  if (readMhrParametricVector(job.parametric_result)) {
    return {
      source: 'unavailable',
      similarity: null,
      xpbdCompleted: false,
      topologyVersion: MHR_TOPOLOGY_VERSION,
      meanStrain: null,
      payloadBase64: null,
    };
  }

  const parametric = readAnnyParametricVector(job.parametric_result);
  if (!parametric) {
    return {
      source: 'unavailable',
      similarity: null,
      xpbdCompleted: false,
      topologyVersion: ANNY_TOPOLOGY_VERSION,
      meanStrain: null,
      payloadBase64: null,
    };
  }

  const { data: bySku } = await input.supabase
    .from('garment_cad_profiles')
    .select()
    .eq('tenant_id', input.tenantId)
    .eq('sku', input.sku.trim())
    .maybeSingle();

  let garment = bySku;
  if (!garment) {
    const { data: byExternal } = await input.supabase
      .from('garment_size_variants')
      .select('garment_id')
      .eq('tenant_id', input.tenantId)
      .eq('external_sku', input.sku.trim())
      .maybeSingle();

    if (byExternal) {
      const { data: parent } = await input.supabase
        .from('garment_cad_profiles')
        .select()
        .eq('tenant_id', input.tenantId)
        .eq('id', byExternal.garment_id)
        .maybeSingle();
      garment = parent;
    }
  }

  if (!garment) {
    return {
      source: 'unavailable',
      similarity: null,
      xpbdCompleted: false,
      topologyVersion: ANNY_TOPOLOGY_VERSION,
      meanStrain: null,
      payloadBase64: null,
    };
  }

  const { data: variants } = await input.supabase
    .from('garment_size_variants')
    .select()
    .eq('tenant_id', input.tenantId)
    .eq('garment_id', garment.id)
    .order('created_at', { ascending: true });

  const storefront = toStorefrontGarment(garment, variants ?? []);
  const size = recommendSize(
    parametric.derived_measurements,
    storefront.category,
    storefront.sizeVariants,
  );

  if (!size.variantId) {
    return {
      source: 'unavailable',
      similarity: null,
      xpbdCompleted: false,
      topologyVersion: ANNY_TOPOLOGY_VERSION,
      meanStrain: null,
      payloadBase64: null,
    };
  }

  await sweepExpiredSimulationCache(input.supabase, input.tenantId);

  const cacheHit = await matchSimulationCache({
    supabase: input.supabase,
    tenantId: input.tenantId,
    variantId: size.variantId,
    phenotype: parametric.phenotype,
  });

  if (cacheHit.row) {
    const bytes = await downloadDeltaBytes(input.supabase, cacheHit.row.deltaStoragePath);
    // A blob from an older schema carries no clearance channel, so the client
    // could not colour fit from it. Treat it as a miss and re-simulate.
    if (bytes && isCurrentSimDelta(bytes)) {
      return {
        source: 'cache',
        similarity: cacheHit.similarity,
        xpbdCompleted: true,
        topologyVersion: cacheHit.row.topologyVersion,
        meanStrain: cacheHit.row.meanStrain,
        payloadBase64: simDeltaToBase64(bytes),
      };
    }
  }

  if (!allowXpbd) {
    return {
      source: 'unavailable',
      similarity: cacheHit.similarity,
      xpbdCompleted: false,
      topologyVersion: ANNY_TOPOLOGY_VERSION,
      meanStrain: null,
      payloadBase64: null,
    };
  }

  const variantRow = (variants ?? []).find((row) => row.id === size.variantId);
  const restMesh = await loadRestLengthMesh(
    input.supabase,
    variantRow?.rest_length_path ?? null,
  );

  if (!restMesh) {
    return {
      source: 'unavailable',
      similarity: cacheHit.similarity,
      xpbdCompleted: false,
      topologyVersion: ANNY_TOPOLOGY_VERSION,
      meanStrain: null,
      payloadBase64: null,
    };
  }

  const heightCm =
    typeof job.height_cm === 'number' && Number.isFinite(job.height_cm) && job.height_cm >= 50
      ? job.height_cm
      : 170;

  const hull = await loadAnnyHullGeometry();
  const deformed = deformHullForParametric(hull.positions, parametric, heightCm);
  const body = buildHullCollisionField(deformed, parametric.derived_measurements);
  const category = readGarmentCategory(garment.category) ?? restMesh.category;
  const xpbd = runXpbdOnHull({
    restMesh,
    mechanical: mechanicalFromProfile(garment),
    body,
    originY: garmentOriginY(body, category),
  });

  const encoded = encodeSimDelta(xpbd.mesh);
  const cacheId = await insertCacheRow({
    supabase: input.supabase,
    tenantId: input.tenantId,
    variantId: size.variantId,
    phenotype: parametric.phenotype,
    meanStrain: xpbd.mesh.meanStrain,
  });

  const storagePath = deltaObjectPath(input.tenantId, size.variantId, cacheId);
  const { error: uploadError } = await input.supabase.storage
    .from(GARMENT_SIMULATIONS_BUCKET)
    .upload(storagePath, encoded, {
      upsert: true,
      contentType: 'application/octet-stream',
      cacheControl: 'public, max-age=31536000, immutable',
    });

  if (uploadError) {
    await input.supabase.from('simulation_cache').delete().eq('id', cacheId);
    throw new Error(uploadError.message);
  }

  const { error: updateError } = await input.supabase
    .from('simulation_cache')
    .update({
      delta_storage_path: storagePath,
      strain_storage_path: storagePath,
      mean_strain: xpbd.mesh.meanStrain,
    })
    .eq('id', cacheId)
    .eq('tenant_id', input.tenantId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  return {
    source: 'xpbd',
    similarity: 1,
    xpbdCompleted: true,
    topologyVersion: ANNY_TOPOLOGY_VERSION,
    meanStrain: xpbd.mesh.meanStrain,
    payloadBase64: simDeltaToBase64(encoded),
  };
}
