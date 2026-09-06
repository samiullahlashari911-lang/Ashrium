import type { SupabaseClient } from '@supabase/supabase-js';

import { GARMENT_CAD_BUCKET } from '@/lib/catalog/rest-length-store';
import { mhrSimulationCacheVector } from '@/lib/fit/mhr-cache-vector';
import { matchSimulationCache } from '@/lib/fit/simulation-match';
import { recommendSize } from '@/lib/fit/size-recommend';
import { vertexBufferToMeters } from '@/lib/graphics/anny-hull';
import {
  buildHullCollisionField,
  loadMhrHullGeometry,
} from '@/lib/graphics/anny-hull-server';
import { decimateToMhrLod3 } from '@/lib/graphics/mhr-lod3';
import {
  encodeSimDelta,
  isCurrentSimDelta,
  simDeltaToBase64,
} from '@/lib/graphics/meshopt-delta';
import { garmentOriginY } from '@/lib/graphics/xpbd-cloth';
import { runDrapePrediction } from '@/lib/ml/replicate';
import { GPU_HOLD_DURING_DRAPE_MS } from '@/lib/ml/session-gpu';
import {
  holdGpuForFitJob,
  releaseGpuHoldForFitJob,
  sleepGpuIfNoActiveFitJobs,
  warmGpuForShopperSubmit,
} from '@/lib/server/session-gpu';
import { toStorefrontGarment } from '@/lib/supabase/garment-profiles';
import type { Database } from '@/types/database';
import type { FitDrapeResolve, SimDrapeMesh } from '@/types/graphics';
import {
  readGarmentCategory,
  readRestLengthMesh,
  type GarmentMechanicalProperties,
  type RestLengthMesh,
} from '@/types/garment';
import {
  ANNY_TOPOLOGY_VERSION,
  MHR_TOPOLOGY_VERSION,
  MHR_VERTEX_COUNT,
  readAnnyParametricVector,
  readMhrParametricVector,
  type AnnyPhenotype,
  type MhrParametricVector,
} from '@/types/hmr';

export const GARMENT_SIMULATIONS_BUCKET = 'garment-simulations';
const SIMULATION_CACHE_TTL_MS = 15 * 60 * 1000;

export interface ResolveFitDrapeInput {
  supabase: SupabaseClient<Database, 'public'>;
  tenantId: string;
  jobId: string;
  sku: string;
  /** When true, run Cog task=drape on cache miss. When false, probe cache only. */
  allowXpbd?: boolean;
}

function unavailable(
  topologyVersion: string,
  similarity: number | null = null,
): FitDrapeResolve {
  return {
    source: 'unavailable',
    similarity,
    xpbdCompleted: false,
    topologyVersion,
    meanStrain: null,
    payloadBase64: null,
  };
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

function toNumberArray(values: Float32Array | Uint32Array): number[] {
  return Array.from(values);
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
  phenotype: AnnyPhenotype;
  meanStrain: number;
  topologyVersion: string;
}): Promise<string> {
  const { data, error } = await options.supabase
    .from('simulation_cache')
    .insert({
      tenant_id: options.tenantId,
      variant_id: options.variantId,
      phenotype: options.phenotype,
      mean_strain: options.meanStrain,
      topology_version: options.topologyVersion,
      expires_at: new Date(Date.now() + SIMULATION_CACHE_TTL_MS).toISOString(),
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Unable to insert simulation_cache row.');
  }

  return data.id;
}

async function persistSimDelta(options: {
  supabase: SupabaseClient<Database, 'public'>;
  tenantId: string;
  variantId: string;
  phenotype: AnnyPhenotype;
  topologyVersion: string;
  mesh: SimDrapeMesh;
}): Promise<string> {
  const encoded = encodeSimDelta(options.mesh);
  const cacheId = await insertCacheRow({
    supabase: options.supabase,
    tenantId: options.tenantId,
    variantId: options.variantId,
    phenotype: options.phenotype,
    meanStrain: options.mesh.meanStrain,
    topologyVersion: options.topologyVersion,
  });

  const storagePath = deltaObjectPath(options.tenantId, options.variantId, cacheId);
  const { error: uploadError } = await options.supabase.storage
    .from(GARMENT_SIMULATIONS_BUCKET)
    .upload(storagePath, encoded, {
      upsert: true,
      contentType: 'application/octet-stream',
      cacheControl: 'public, max-age=31536000, immutable',
    });

  if (uploadError) {
    await options.supabase.from('simulation_cache').delete().eq('id', cacheId);
    throw new Error(uploadError.message);
  }

  const { error: updateError } = await options.supabase
    .from('simulation_cache')
    .update({
      delta_storage_path: storagePath,
      strain_storage_path: storagePath,
      mean_strain: options.mesh.meanStrain,
    })
    .eq('id', cacheId)
    .eq('tenant_id', options.tenantId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  return simDeltaToBase64(encoded);
}

async function lookupGarment(
  supabase: SupabaseClient<Database, 'public'>,
  tenantId: string,
  sku: string,
) {
  const { data: bySku } = await supabase
    .from('garment_cad_profiles')
    .select()
    .eq('tenant_id', tenantId)
    .eq('sku', sku.trim())
    .maybeSingle();

  if (bySku) {
    return bySku;
  }

  const { data: byExternal } = await supabase
    .from('garment_size_variants')
    .select('garment_id')
    .eq('tenant_id', tenantId)
    .eq('external_sku', sku.trim())
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

  return parent ?? null;
}

async function resolveCacheHit(options: {
  supabase: SupabaseClient<Database, 'public'>;
  tenantId: string;
  variantId: string;
  phenotype: AnnyPhenotype;
  topologyVersion: string;
}): Promise<FitDrapeResolve | null> {
  const cacheHit = await matchSimulationCache({
    supabase: options.supabase,
    tenantId: options.tenantId,
    variantId: options.variantId,
    phenotype: options.phenotype,
    topologyVersion: options.topologyVersion,
  });

  if (cacheHit.row) {
    const bytes = await downloadDeltaBytes(options.supabase, cacheHit.row.deltaStoragePath);
    if (bytes && isCurrentSimDelta(bytes, options.topologyVersion)) {
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

  return null;
}

async function releaseGpuAfterDrape(jobId: string): Promise<void> {
  await releaseGpuHoldForFitJob(jobId);
  void sleepGpuIfNoActiveFitJobs();
}

async function runNewtonDrape(options: {
  jobId: string;
  parametric: MhrParametricVector;
  restMesh: RestLengthMesh;
  mechanical: GarmentMechanicalProperties;
  category: RestLengthMesh['category'];
}): Promise<SimDrapeMesh> {
  if (!options.parametric.vertex_positions) {
    throw new Error('MHR vertex_positions are required for Newton drape. Refusing a dummy hull.');
  }

  if (options.parametric.vertex_positions.length !== MHR_VERTEX_COUNT * 3) {
    throw new Error('MHR vertex_positions do not match LOD 1.');
  }

  const hull = await loadMhrHullGeometry();
  const lod1 = vertexBufferToMeters(options.parametric.vertex_positions);
  const lod3 = decimateToMhrLod3(lod1, hull.indices);
  const body = buildHullCollisionField(lod3.positions, options.parametric.derived_measurements);
  const originY = garmentOriginY(body, options.category);

  await holdGpuForFitJob(options.jobId, GPU_HOLD_DURING_DRAPE_MS);

  try {
    await warmGpuForShopperSubmit();
  } catch {
    // Prediction can still cold-start on the Deployment.
  }

  try {
    return await runDrapePrediction({
      colliderPositions: toNumberArray(lod3.positions),
      colliderIndices: toNumberArray(lod3.indices),
      garmentRestMesh: options.restMesh,
      tensileStiffness: options.mechanical.tensileStiffness,
      bendingRigidity: options.mechanical.bendingRigidity,
      shearStiffness: options.mechanical.shearStiffness,
      areaDensity: options.mechanical.areaDensity,
      originY,
    });
  } finally {
    await releaseGpuAfterDrape(options.jobId);
  }
}

/**
 * Drape resolution: cache hit → signed delta; miss → Cog task=drape (Newton XPBD)
 * on MHR LOD 3 → meshopt upload → cache insert. Does not block task=body.
 * JS XPBD is not on this path.
 */
export async function resolveFitDrape(input: ResolveFitDrapeInput): Promise<FitDrapeResolve> {
  const allowNewton = input.allowXpbd ?? true;
  const { data: job, error: jobError } = await input.supabase
    .from('fit_jobs')
    .select('id, status, height_cm, parametric_result')
    .eq('id', input.jobId)
    .eq('tenant_id', input.tenantId)
    .maybeSingle();

  if (jobError || !job || job.status !== 'completed') {
    return unavailable(MHR_TOPOLOGY_VERSION);
  }

  const garment = await lookupGarment(input.supabase, input.tenantId, input.sku);
  if (!garment) {
    return unavailable(MHR_TOPOLOGY_VERSION);
  }

  const { data: variants } = await input.supabase
    .from('garment_size_variants')
    .select()
    .eq('tenant_id', input.tenantId)
    .eq('garment_id', garment.id)
    .order('created_at', { ascending: true });

  const storefront = toStorefrontGarment(garment, variants ?? []);
  const mhr = readMhrParametricVector(job.parametric_result);
  const anny = readAnnyParametricVector(job.parametric_result);
  const measurements = mhr?.derived_measurements ?? anny?.derived_measurements;
  if (!measurements) {
    return unavailable(MHR_TOPOLOGY_VERSION);
  }

  const size = recommendSize(measurements, storefront.category, storefront.sizeVariants);
  if (!size.variantId) {
    return unavailable(mhr ? MHR_TOPOLOGY_VERSION : ANNY_TOPOLOGY_VERSION);
  }

  await sweepExpiredSimulationCache(input.supabase, input.tenantId);

  const heightCm =
    typeof job.height_cm === 'number' && Number.isFinite(job.height_cm) && job.height_cm >= 50
      ? job.height_cm
      : 170;

  if (mhr) {
    const phenotype = mhrSimulationCacheVector({
      measurements: mhr.derived_measurements,
      heightCm,
      heightResidualCm: mhr.height_residual_cm,
      clothingResidual: mhr.clothing_residual,
    });
    const cached = await resolveCacheHit({
      supabase: input.supabase,
      tenantId: input.tenantId,
      variantId: size.variantId,
      phenotype,
      topologyVersion: MHR_TOPOLOGY_VERSION,
    });
    if (cached) {
      await releaseGpuAfterDrape(input.jobId);
      return cached;
    }

    if (!allowNewton) {
      return unavailable(MHR_TOPOLOGY_VERSION);
    }

    const variantRow = (variants ?? []).find((row) => row.id === size.variantId);
    const restMesh = await loadRestLengthMesh(
      input.supabase,
      variantRow?.rest_length_path ?? null,
    );
    if (!restMesh) {
      return unavailable(MHR_TOPOLOGY_VERSION);
    }

    const category = readGarmentCategory(garment.category) ?? restMesh.category;
    const mesh = await runNewtonDrape({
      jobId: input.jobId,
      parametric: mhr,
      restMesh,
      mechanical: mechanicalFromProfile(garment),
      category,
    });
    const payloadBase64 = await persistSimDelta({
      supabase: input.supabase,
      tenantId: input.tenantId,
      variantId: size.variantId,
      phenotype,
      topologyVersion: MHR_TOPOLOGY_VERSION,
      mesh,
    });

    return {
      source: 'xpbd',
      similarity: 1,
      xpbdCompleted: true,
      topologyVersion: MHR_TOPOLOGY_VERSION,
      meanStrain: mesh.meanStrain,
      payloadBase64,
    };
  }

  if (!anny) {
    return unavailable(ANNY_TOPOLOGY_VERSION);
  }

  const cachedAnny = await resolveCacheHit({
    supabase: input.supabase,
    tenantId: input.tenantId,
    variantId: size.variantId,
    phenotype: anny.phenotype,
    topologyVersion: ANNY_TOPOLOGY_VERSION,
  });
  if (cachedAnny) {
    await releaseGpuAfterDrape(input.jobId);
    return cachedAnny;
  }

  return unavailable(ANNY_TOPOLOGY_VERSION);
}
