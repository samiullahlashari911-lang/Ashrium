-- Phase 4 follow-up: harden baseline helper functions and cover the cache FK.

ALTER FUNCTION public.get_current_tenant_id() SET search_path = '';
ALTER FUNCTION public.set_updated_at() SET search_path = '';

REVOKE ALL ON FUNCTION public.broadcast_fit_job_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.broadcast_fit_job_change() FROM anon, authenticated;

DROP POLICY IF EXISTS tenants_select_own ON public.tenants;
CREATE POLICY tenants_select_own
  ON public.tenants
  FOR SELECT
  USING (owner_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS tenants_update_own ON public.tenants;
CREATE POLICY tenants_update_own
  ON public.tenants
  FOR UPDATE
  USING (owner_user_id = (SELECT auth.uid()))
  WITH CHECK (owner_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS fit_jobs_select_tenant ON public.fit_jobs;
CREATE POLICY fit_jobs_select_tenant
  ON public.fit_jobs
  FOR SELECT
  USING (
    ((SELECT auth.jwt()) -> 'app_metadata' ->> 'tenant_id')::UUID = tenant_id
  );

CREATE INDEX IF NOT EXISTS simulation_cache_variant_id_idx
  ON public.simulation_cache (variant_id);
