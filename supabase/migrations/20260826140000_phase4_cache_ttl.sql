-- Phase 4 privacy: simulation matching vectors are biometric phenotype data.
-- Keep them short-lived and delete their storage payload opportunistically in
-- the server resolve path. Phase 7 adds the scheduled sweep.

ALTER TABLE public.simulation_cache
  ADD COLUMN expires_at TIMESTAMPTZ NOT NULL
    DEFAULT (now() + INTERVAL '15 minutes');

CREATE INDEX simulation_cache_expires_at_idx
  ON public.simulation_cache (expires_at);

CREATE OR REPLACE FUNCTION public.match_simulation_cache(
  p_tenant_id UUID,
  p_variant_id UUID,
  p_query extensions.vector(6),
  p_match_threshold DOUBLE PRECISION DEFAULT 0.995,
  p_match_count INTEGER DEFAULT 1,
  p_topology_version TEXT DEFAULT 'anny-13380-104'
)
RETURNS TABLE (
  id UUID,
  variant_id UUID,
  delta_storage_path TEXT,
  strain_storage_path TEXT,
  mean_strain DOUBLE PRECISION,
  topology_version TEXT,
  similarity DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT
    sc.id,
    sc.variant_id,
    sc.delta_storage_path,
    sc.strain_storage_path,
    sc.mean_strain,
    sc.topology_version,
    (1.0 - (sc.phenotype <=> p_query))::DOUBLE PRECISION AS similarity
  FROM public.simulation_cache sc
  WHERE sc.tenant_id = p_tenant_id
    AND sc.variant_id = p_variant_id
    AND sc.topology_version = p_topology_version
    AND sc.delta_storage_path IS NOT NULL
    AND sc.expires_at > now()
    AND (1.0 - (sc.phenotype <=> p_query)) >= p_match_threshold
  ORDER BY sc.phenotype <=> p_query
  LIMIT LEAST(GREATEST(p_match_count, 1), 10);
$$;
