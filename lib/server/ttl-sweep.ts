import {
  isBiometricAssetPath,
  purgeBiometricJobImages,
} from '@/lib/server/biometrics-wipe';
import { sleepGpuIfNoActiveFitJobs } from '@/lib/server/session-gpu';
import { createServiceClient } from '@/lib/supabase/service';
import type { Json } from '@/types/database';

const BIOMETRIC_BUCKET = 'biometrics';
const GARMENT_SIMULATIONS_BUCKET = 'garment-simulations';
const SWEEP_BATCH = 200;
const BIOMETRIC_TTL_MS = 15 * 60 * 1000;

export interface PrivacyTtlSweepResult {
  parametricCleared: number;
  biometricMeshesDeleted: number;
  rateLimitHitsDeleted: number;
  simulationCacheDeleted: number;
  simulationObjectsRemoved: number;
  biometricJobsPurged: number;
  biometricObjectsRemoved: number;
}

function readCount(value: Json | null, key: string): number {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 0;
  }

  const raw = value[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

function isStaleObject(createdAt: string | undefined, cutoffMs: number): boolean {
  if (!createdAt) {
    return false;
  }

  const createdMs = Date.parse(createdAt);
  return Number.isFinite(createdMs) && createdMs <= cutoffMs;
}

async function listStorageEntries(
  supabase: ReturnType<typeof createServiceClient>,
  bucket: string,
  prefix: string,
): Promise<Array<{ name: string; id: string | null; created_at?: string }>> {
  const entries: Array<{ name: string; id: string | null; created_at?: string }> = [];
  const pageSize = 100;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit: pageSize,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });

    if (error || !data || data.length === 0) {
      break;
    }

    entries.push(
      ...data.map((entry) => ({
        name: entry.name,
        id: entry.id,
        created_at: entry.created_at ?? undefined,
      })),
    );

    if (data.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return entries;
}

async function collectStaleBiometricObjectPaths(
  supabase: ReturnType<typeof createServiceClient>,
  cutoffMs: number,
): Promise<string[]> {
  const stale: string[] = [];
  const tenants = await listStorageEntries(supabase, BIOMETRIC_BUCKET, '');

  for (const tenant of tenants) {
    if (!tenant.name) {
      continue;
    }

    const jobs = await listStorageEntries(supabase, BIOMETRIC_BUCKET, tenant.name);
    for (const job of jobs) {
      const jobPrefix = `${tenant.name}/${job.name}`;
      if (job.id && isBiometricAssetPath(jobPrefix) && isStaleObject(job.created_at, cutoffMs)) {
        stale.push(jobPrefix);
        continue;
      }

      const files = await listStorageEntries(supabase, BIOMETRIC_BUCKET, jobPrefix);
      for (const file of files) {
        const filePath = `${jobPrefix}/${file.name}`;
        if (isBiometricAssetPath(filePath) && isStaleObject(file.created_at, cutoffMs)) {
          stale.push(filePath);
        }
      }
    }
  }

  return stale;
}

export async function runPrivacyTtlSweep(): Promise<PrivacyTtlSweepResult> {
  const supabase = createServiceClient();
  const { data: dbSweep, error: dbError } = await supabase.rpc('sweep_privacy_ttl_db');
  if (dbError) {
    throw new Error(dbError.message);
  }

  const { data: expiredCache, error: cacheError } = await supabase.rpc(
    'list_expired_simulation_cache',
    { p_limit: SWEEP_BATCH },
  );
  if (cacheError) {
    throw new Error(cacheError.message);
  }

  const cacheRows = expiredCache ?? [];
  const simulationPaths = Array.from(
    new Set(
      cacheRows.flatMap((row) => [
        ...(row.delta_storage_path ? [row.delta_storage_path] : []),
        ...(row.strain_storage_path ? [row.strain_storage_path] : []),
      ]),
    ),
  );

  let simulationObjectsRemoved = 0;
  if (simulationPaths.length > 0) {
    const { error: removeError } = await supabase.storage
      .from(GARMENT_SIMULATIONS_BUCKET)
      .remove(simulationPaths);
    if (!removeError) {
      simulationObjectsRemoved = simulationPaths.length;
    }
  }

  if (cacheRows.length > 0) {
    const { error: deleteError } = await supabase
      .from('simulation_cache')
      .delete()
      .in('id', cacheRows.map((row) => row.id));
    if (deleteError) {
      throw new Error(deleteError.message);
    }
  }

  const { data: staleJobs, error: staleError } = await supabase.rpc(
    'list_stale_biometric_job_images',
    { p_limit: SWEEP_BATCH },
  );
  if (staleError) {
    throw new Error(staleError.message);
  }

  let biometricJobsPurged = 0;
  for (const job of staleJobs ?? []) {
    const wasPurged = await purgeBiometricJobImages(job.front_image_path, job.side_image_path);
    if (!wasPurged) {
      continue;
    }

    const { error: clearError } = await supabase
      .from('fit_jobs')
      .update({
        front_image_path: null,
        side_image_path: null,
      })
      .eq('id', job.id)
      .eq('tenant_id', job.tenant_id);

    if (!clearError) {
      biometricJobsPurged += 1;
    }
  }

  const leftover = await collectStaleBiometricObjectPaths(
    supabase,
    Date.now() - BIOMETRIC_TTL_MS,
  );
  let biometricObjectsRemoved = 0;
  if (leftover.length > 0) {
    const { error: leftoverError } = await supabase.storage.from(BIOMETRIC_BUCKET).remove(leftover);
    if (!leftoverError) {
      biometricObjectsRemoved = leftover.length;
    }
  }

  try {
    await sleepGpuIfNoActiveFitJobs();
  } catch {
    // Privacy sweep must not fail because GPU scale failed.
  }

  return {
    parametricCleared: readCount(dbSweep, 'parametric_cleared'),
    biometricMeshesDeleted: readCount(dbSweep, 'biometric_meshes_deleted'),
    rateLimitHitsDeleted: readCount(dbSweep, 'rate_limit_hits_deleted'),
    simulationCacheDeleted: cacheRows.length,
    simulationObjectsRemoved,
    biometricJobsPurged,
    biometricObjectsRemoved,
  };
}
