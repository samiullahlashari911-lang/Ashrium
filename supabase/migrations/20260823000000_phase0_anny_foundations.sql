-- Phase 0: ANNY parametric contract, WebP biometric paths, size variants,
-- vector simulation cache, Realtime fit_job:{id} broadcast, and phenotype TTL.

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ============================================================================
-- fit_jobs: extend, do not drop legacy SMPL-X / glTF columns
-- ============================================================================
ALTER TABLE public.fit_jobs
  ADD COLUMN height_cm DOUBLE PRECISION,
  ADD COLUMN sex TEXT,
  ADD COLUMN weight_kg DOUBLE PRECISION,
  ADD COLUMN front_image_path TEXT,
  ADD COLUMN side_image_path TEXT,
  ADD COLUMN parametric_result JSONB,
  ADD COLUMN inference_duration_ms INTEGER,
  ADD COLUMN parametric_result_expires_at TIMESTAMPTZ,
  ADD CONSTRAINT fit_jobs_sex_check
    CHECK (sex IS NULL OR sex IN ('female', 'male', 'unspecified')),
  ADD CONSTRAINT fit_jobs_height_cm_check
    CHECK (height_cm IS NULL OR (height_cm >= 50 AND height_cm <= 250)),
  ADD CONSTRAINT fit_jobs_weight_kg_check
    CHECK (weight_kg IS NULL OR (weight_kg >= 10 AND weight_kg <= 400)),
  ADD CONSTRAINT fit_jobs_inference_duration_ms_check
    CHECK (inference_duration_ms IS NULL OR inference_duration_ms >= 0);

CREATE INDEX fit_jobs_parametric_result_expires_at_idx
  ON public.fit_jobs (parametric_result_expires_at)
  WHERE parametric_result_expires_at IS NOT NULL;

-- Phase 7 wires the cron; this function is the TTL plan for cached phenotypes.
CREATE OR REPLACE FUNCTION public.sweep_expired_parametric_results()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  cleared_count INTEGER;
BEGIN
  UPDATE public.fit_jobs
  SET
    parametric_result = NULL,
    parametric_result_expires_at = NULL
  WHERE parametric_result_expires_at IS NOT NULL
    AND parametric_result_expires_at <= now();

  GET DIAGNOSTICS cleared_count = ROW_COUNT;
  RETURN cleared_count;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_expired_parametric_results() FROM PUBLIC;

-- Private Realtime topic fit_job:{id} only. Do not subscribe with wildcards.
CREATE OR REPLACE FUNCTION public.broadcast_fit_job_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object(
      'id', NEW.id,
      'tenant_id', NEW.tenant_id,
      'status', NEW.status
    ),
    TG_OP,
    concat('fit_job:', NEW.id::text),
    true
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.broadcast_fit_job_change() FROM PUBLIC;

CREATE TRIGGER fit_jobs_broadcast_change
  AFTER INSERT OR UPDATE ON public.fit_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.broadcast_fit_job_change();

-- ============================================================================
-- garment_cad_profiles: ingest metadata. Mechanical columns stay the KES target.
-- ============================================================================
ALTER TABLE public.garment_cad_profiles
  ADD COLUMN category TEXT,
  ADD COLUMN composition JSONB,
  ADD COLUMN gsm DOUBLE PRECISION,
  ADD COLUMN ingest_confidence DOUBLE PRECISION,
  ADD COLUMN ingest_tier SMALLINT,
  ADD COLUMN mode TEXT,
  ADD COLUMN approximate_fit BOOLEAN NOT NULL DEFAULT true,
  ADD CONSTRAINT garment_cad_profiles_gsm_check
    CHECK (gsm IS NULL OR gsm > 0),
  ADD CONSTRAINT garment_cad_profiles_ingest_confidence_check
    CHECK (
      ingest_confidence IS NULL
      OR (ingest_confidence >= 0 AND ingest_confidence <= 1)
    ),
  ADD CONSTRAINT garment_cad_profiles_ingest_tier_check
    CHECK (ingest_tier IS NULL OR ingest_tier IN (1, 2)),
  ADD CONSTRAINT garment_cad_profiles_mode_check
    CHECK (mode IS NULL OR mode IN ('A', 'B', 'C'));

-- ============================================================================
-- garment_size_variants
-- ============================================================================
CREATE TABLE public.garment_size_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  garment_id UUID NOT NULL REFERENCES public.garment_cad_profiles (id) ON DELETE CASCADE,
  size_code TEXT NOT NULL,
  chest_cm DOUBLE PRECISION NOT NULL,
  waist_cm DOUBLE PRECISION NOT NULL,
  hip_cm DOUBLE PRECISION NOT NULL,
  length_cm DOUBLE PRECISION NOT NULL,
  rest_length_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT garment_size_variants_garment_size_unique UNIQUE (garment_id, size_code),
  CONSTRAINT garment_size_variants_size_code_length_check
    CHECK (char_length(size_code) BETWEEN 1 AND 16),
  CONSTRAINT garment_size_variants_measurements_check
    CHECK (
      chest_cm > 0
      AND waist_cm > 0
      AND hip_cm > 0
      AND length_cm > 0
    )
);

CREATE INDEX garment_size_variants_tenant_id_idx
  ON public.garment_size_variants (tenant_id);

ALTER TABLE public.garment_size_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY garment_size_variants_select_tenant
  ON public.garment_size_variants
  FOR SELECT
  USING (tenant_id = public.get_current_tenant_id());

CREATE POLICY garment_size_variants_insert_tenant
  ON public.garment_size_variants
  FOR INSERT
  WITH CHECK (tenant_id = public.get_current_tenant_id());

CREATE POLICY garment_size_variants_update_tenant
  ON public.garment_size_variants
  FOR UPDATE
  USING (tenant_id = public.get_current_tenant_id())
  WITH CHECK (tenant_id = public.get_current_tenant_id());

CREATE POLICY garment_size_variants_delete_tenant
  ON public.garment_size_variants
  FOR DELETE
  USING (tenant_id = public.get_current_tenant_id());

-- ============================================================================
-- simulation_cache (empty until Phase 4)
-- ============================================================================
CREATE TABLE public.simulation_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES public.garment_size_variants (id) ON DELETE CASCADE,
  phenotype extensions.vector(6) NOT NULL,
  delta_storage_path TEXT,
  strain_storage_path TEXT,
  mean_strain DOUBLE PRECISION,
  topology_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT simulation_cache_mean_strain_check
    CHECK (mean_strain IS NULL OR mean_strain >= 0),
  CONSTRAINT simulation_cache_topology_version_length_check
    CHECK (char_length(topology_version) BETWEEN 1 AND 64)
);

CREATE INDEX simulation_cache_tenant_variant_idx
  ON public.simulation_cache (tenant_id, variant_id);

ALTER TABLE public.simulation_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY simulation_cache_select_tenant
  ON public.simulation_cache
  FOR SELECT
  USING (tenant_id = public.get_current_tenant_id());

REVOKE INSERT, UPDATE, DELETE ON public.simulation_cache FROM anon, authenticated;
GRANT SELECT ON public.simulation_cache TO authenticated;

-- ============================================================================
-- Biometrics bucket: image/webp only, {tenant}/{job}/front.webp|side.webp
-- ============================================================================
UPDATE storage.buckets
SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/webp']
WHERE id = 'biometrics';

DROP POLICY IF EXISTS biometrics_insert_tenant ON storage.objects;

CREATE POLICY biometrics_insert_tenant
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'biometrics'
    AND storage.extension(name) = 'webp'
    AND (storage.foldername(name))[1] =
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    AND (storage.foldername(name))[2] IS NOT NULL
    AND (storage.foldername(name))[3] IS NULL
    AND (
      name LIKE '%/front.webp'
      OR name LIKE '%/side.webp'
    )
  );
