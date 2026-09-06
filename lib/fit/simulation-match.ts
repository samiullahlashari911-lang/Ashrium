import type { SupabaseClient } from '@supabase/supabase-js';

import { HNSW_SIMILARITY_THRESHOLD } from '@/lib/fit/confidence-gate';
import type { AnnyPhenotype } from '@/types/hmr';
import { ANNY_TOPOLOGY_VERSION } from '@/types/hmr';
import type { Database } from '@/types/database';

export interface SimulationMatchRow {
  id: string;
  variantId: string;
  deltaStoragePath: string;
  strainStoragePath: string | null;
  meanStrain: number | null;
  topologyVersion: string;
  similarity: number;
}

export interface SimulationMatch {
  similarity: number | null;
  xpbdCompleted: boolean;
  row: SimulationMatchRow | null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function phenotypeLiteral(phenotype: AnnyPhenotype): string {
  return `[${phenotype.map((value) => value.toFixed(8)).join(',')}]`;
}

/**
 * Best cosine match via match_simulation_cache RPC (HNSW, threshold ≥ 0.995).
 * Falls back to a linear scan when the RPC is unavailable.
 */
export async function matchSimulationCache(options: {
  supabase: SupabaseClient<Database, 'public'>;
  tenantId: string;
  variantId: string | null;
  phenotype: AnnyPhenotype;
  topologyVersion?: string;
}): Promise<SimulationMatch> {
  if (!options.variantId) {
    return { similarity: null, xpbdCompleted: false, row: null };
  }

  const topologyVersion = options.topologyVersion ?? ANNY_TOPOLOGY_VERSION;

  const { data: rpcRows, error: rpcError } = await options.supabase.rpc(
    'match_simulation_cache',
    {
      p_tenant_id: options.tenantId,
      p_variant_id: options.variantId,
      p_query: options.phenotype,
      p_match_threshold: HNSW_SIMILARITY_THRESHOLD,
      p_match_count: 1,
      p_topology_version: topologyVersion,
    },
  );

  if (!rpcError && rpcRows && rpcRows.length > 0) {
    const best = rpcRows[0];
    if (
      typeof best.delta_storage_path === 'string'
      && best.delta_storage_path.length > 0
      && isFiniteNumber(best.similarity)
    ) {
      return {
        similarity: best.similarity,
        xpbdCompleted: true,
        row: {
          id: best.id,
          variantId: best.variant_id,
          deltaStoragePath: best.delta_storage_path,
          strainStoragePath: best.strain_storage_path,
          meanStrain: best.mean_strain,
          topologyVersion: best.topology_version,
          similarity: best.similarity,
        },
      };
    }
  }

  return matchSimulationCacheLinear({
    supabase: options.supabase,
    tenantId: options.tenantId,
    variantId: options.variantId,
    phenotype: options.phenotype,
    topologyVersion,
  });
}

export function cosineSimilarity(left: number[], right: number[]): number | null {
  if (left.length === 0 || left.length !== right.length) {
    return null;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }

  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  if (denominator <= 1e-12) {
    return null;
  }

  return dot / denominator;
}

function readPhenotype(value: unknown): number[] | null {
  if (Array.isArray(value) && value.length === 6 && value.every(isFiniteNumber)) {
    return value.slice();
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim().replace(/^\[/, '').replace(/\]$/, '');
  const parts = trimmed.split(',').map((part) => Number.parseFloat(part.trim()));
  if (parts.length !== 6 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  return parts;
}

async function matchSimulationCacheLinear(options: {
  supabase: SupabaseClient<Database, 'public'>;
  tenantId: string;
  variantId: string;
  phenotype: AnnyPhenotype;
  topologyVersion: string;
}): Promise<SimulationMatch> {
  const { data, error } = await options.supabase
    .from('simulation_cache')
    .select('id, variant_id, phenotype, delta_storage_path, strain_storage_path, mean_strain, topology_version')
    .eq('tenant_id', options.tenantId)
    .eq('variant_id', options.variantId)
    .eq('topology_version', options.topologyVersion)
    .gt('expires_at', new Date().toISOString());

  if (error || !data || data.length === 0) {
    return { similarity: null, xpbdCompleted: false, row: null };
  }

  let bestSimilarity: number | null = null;
  let bestRow: SimulationMatchRow | null = null;

  for (const row of data) {
    const cached = readPhenotype(row.phenotype);
    if (!cached || typeof row.delta_storage_path !== 'string' || row.delta_storage_path.length === 0) {
      continue;
    }

    const similarity = cosineSimilarity(options.phenotype, cached);
    if (similarity === null) {
      continue;
    }

    if (bestSimilarity === null || similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestRow = {
        id: row.id,
        variantId: row.variant_id,
        deltaStoragePath: row.delta_storage_path,
        strainStoragePath: row.strain_storage_path,
        meanStrain: row.mean_strain,
        topologyVersion: row.topology_version,
        similarity,
      };
    }
  }

  const closeEnough =
    bestSimilarity !== null && bestSimilarity >= HNSW_SIMILARITY_THRESHOLD && bestRow !== null;

  return {
    similarity: bestSimilarity,
    xpbdCompleted: closeEnough,
    row: closeEnough ? bestRow : null,
  };
}

export { phenotypeLiteral };
