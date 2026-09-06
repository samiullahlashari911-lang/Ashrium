-- Phase 7: durable rate limits, expanded phenotype TTL, and scheduled DB sweep.
-- Storage object deletion still runs from GET /api/v1/cron/ttl-sweep (service role).

-- ============================================================================
-- Durable sliding-window rate limit (survives serverless instances)
-- ============================================================================
CREATE TABLE public.rate_limit_hits (
  identifier TEXT NOT NULL,
  hit_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX rate_limit_hits_identifier_hit_at_idx
  ON public.rate_limit_hits (identifier, hit_at DESC);

ALTER TABLE public.rate_limit_hits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.rate_limit_hits FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_identifier TEXT,
  p_limit INTEGER,
  p_window_ms INTEGER
)
RETURNS TABLE (
  allowed BOOLEAN,
  remaining INTEGER,
  reset_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_count INTEGER;
  v_oldest TIMESTAMPTZ;
  v_allowed BOOLEAN;
  v_now TIMESTAMPTZ := now();
BEGIN
  IF p_identifier IS NULL
    OR char_length(p_identifier) = 0
    OR char_length(p_identifier) > 256
    OR p_limit IS NULL
    OR p_limit < 1
    OR p_window_ms IS NULL
    OR p_window_ms < 1
  THEN
    RAISE EXCEPTION 'invalid rate limit arguments';
  END IF;

  v_window_start := v_now - (p_window_ms::TEXT || ' milliseconds')::INTERVAL;

  PERFORM pg_advisory_xact_lock(hashtext(p_identifier));

  DELETE FROM public.rate_limit_hits
  WHERE identifier = p_identifier
    AND hit_at <= v_window_start;

  SELECT COUNT(*), MIN(hit_at)
  INTO v_count, v_oldest
  FROM public.rate_limit_hits
  WHERE identifier = p_identifier;

  v_count := COALESCE(v_count, 0);
  v_allowed := v_count < p_limit;

  IF v_allowed THEN
    INSERT INTO public.rate_limit_hits (identifier, hit_at)
    VALUES (p_identifier, v_now);
    v_count := v_count + 1;
    IF v_oldest IS NULL THEN
      v_oldest := v_now;
    END IF;
  END IF;

  allowed := v_allowed;
  remaining := GREATEST(p_limit - v_count, 0);
  reset_at := COALESCE(v_oldest, v_now) + (p_window_ms::TEXT || ' milliseconds')::INTERVAL;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_rate_limit(TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- Phenotype TTL: honor expires_at, and never leave a durable parametric_result
-- ============================================================================
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
  WHERE parametric_result IS NOT NULL
    AND (
      (
        parametric_result_expires_at IS NOT NULL
        AND parametric_result_expires_at <= now()
      )
      OR (
        parametric_result_expires_at IS NULL
        AND updated_at <= now() - INTERVAL '15 minutes'
      )
    );

  GET DIAGNOSTICS cleared_count = ROW_COUNT;
  RETURN cleared_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_expired_simulation_cache(p_limit INTEGER DEFAULT 200)
RETURNS TABLE (
  id UUID,
  tenant_id UUID,
  delta_storage_path TEXT,
  strain_storage_path TEXT
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    sc.id,
    sc.tenant_id,
    sc.delta_storage_path,
    sc.strain_storage_path
  FROM public.simulation_cache sc
  WHERE sc.expires_at <= now()
  ORDER BY sc.expires_at ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
$$;

CREATE OR REPLACE FUNCTION public.list_stale_biometric_job_images(p_limit INTEGER DEFAULT 200)
RETURNS TABLE (
  id UUID,
  tenant_id UUID,
  front_image_path TEXT,
  side_image_path TEXT
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    fj.id,
    fj.tenant_id,
    fj.front_image_path,
    fj.side_image_path
  FROM public.fit_jobs fj
  WHERE (fj.front_image_path IS NOT NULL OR fj.side_image_path IS NOT NULL)
    AND fj.created_at <= now() - INTERVAL '15 minutes'
  ORDER BY fj.created_at ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
$$;

CREATE OR REPLACE FUNCTION public.sweep_privacy_ttl_db()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  parametric_cleared INTEGER;
  meshes_deleted INTEGER;
  rate_hits_deleted INTEGER;
BEGIN
  parametric_cleared := public.sweep_expired_parametric_results();
  meshes_deleted := public.delete_expired_biometric_mesh_metadata();

  DELETE FROM public.rate_limit_hits
  WHERE hit_at < now() - INTERVAL '1 hour';
  GET DIAGNOSTICS rate_hits_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'parametric_cleared', parametric_cleared,
    'biometric_meshes_deleted', meshes_deleted,
    'rate_limit_hits_deleted', rate_hits_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_expired_simulation_cache(INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_stale_biometric_job_images(INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sweep_privacy_ttl_db()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sweep_expired_parametric_results()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_expired_biometric_mesh_metadata()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_rate_limit(TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.consume_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_expired_simulation_cache(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_stale_biometric_job_images(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.sweep_privacy_ttl_db() TO service_role;
GRANT EXECUTE ON FUNCTION public.sweep_expired_parametric_results() TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_expired_biometric_mesh_metadata() TO service_role;

-- Optional pg_cron for the SQL-only half of the sweep (storage still needs
-- GET /api/v1/cron/ttl-sweep). Skip quietly when the extension is unavailable.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;

  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'ashrium-privacy-ttl-db';

  PERFORM cron.schedule(
    'ashrium-privacy-ttl-db',
    '*/5 * * * *',
    $cron$SELECT public.sweep_privacy_ttl_db();$cron$
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron unavailable; schedule GET /api/v1/cron/ttl-sweep instead';
END;
$$;
