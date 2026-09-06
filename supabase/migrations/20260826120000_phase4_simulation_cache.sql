-- Phase 4: HNSW simulation_cache match RPC and private
-- garment-simulations storage for storefront XPBD / delta drape.

CREATE INDEX IF NOT EXISTS simulation_cache_phenotype_hnsw_idx
  ON public.simulation_cache
  USING hnsw (phenotype extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS simulation_cache_match_scope_idx
  ON public.simulation_cache (tenant_id, variant_id, topology_version)
  WHERE delta_storage_path IS NOT NULL;

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
    AND (1.0 - (sc.phenotype <=> p_query)) >= p_match_threshold
  ORDER BY sc.phenotype <=> p_query
  LIMIT LEAST(GREATEST(p_match_count, 1), 10);
$$;

REVOKE ALL ON FUNCTION public.match_simulation_cache(
  UUID, UUID, extensions.vector, DOUBLE PRECISION, INTEGER, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.match_simulation_cache(
  UUID, UUID, extensions.vector, DOUBLE PRECISION, INTEGER, TEXT
) TO service_role;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'garment-simulations',
  'garment-simulations',
  false,
  8388608,
  ARRAY['application/octet-stream']
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS garment_simulations_select_service_role ON storage.objects;
CREATE POLICY garment_simulations_select_service_role
  ON storage.objects
  FOR SELECT
  TO service_role
  USING (bucket_id = 'garment-simulations');

DROP POLICY IF EXISTS garment_simulations_insert_service_role ON storage.objects;
CREATE POLICY garment_simulations_insert_service_role
  ON storage.objects
  FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'garment-simulations');

DROP POLICY IF EXISTS garment_simulations_update_service_role ON storage.objects;
CREATE POLICY garment_simulations_update_service_role
  ON storage.objects
  FOR UPDATE
  TO service_role
  USING (bucket_id = 'garment-simulations')
  WITH CHECK (bucket_id = 'garment-simulations');

DROP POLICY IF EXISTS garment_simulations_delete_service_role ON storage.objects;
CREATE POLICY garment_simulations_delete_service_role
  ON storage.objects
  FOR DELETE
  TO service_role
  USING (bucket_id = 'garment-simulations');
