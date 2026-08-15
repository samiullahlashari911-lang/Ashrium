-- Asynchronous HMR job state owned and readable only by its tenant.

CREATE TABLE public.fit_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  replicate_prediction_id TEXT UNIQUE,
  input_image_url TEXT,
  smplx_params JSONB,
  gltf_output_url TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fit_jobs_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

CREATE INDEX fit_jobs_tenant_created_at_idx
  ON public.fit_jobs (tenant_id, created_at DESC);

CREATE TRIGGER fit_jobs_set_updated_at
  BEFORE UPDATE ON public.fit_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.fit_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY fit_jobs_select_tenant
  ON public.fit_jobs
  FOR SELECT
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid = tenant_id
  );

REVOKE INSERT, UPDATE, DELETE ON public.fit_jobs FROM anon, authenticated;
GRANT SELECT ON public.fit_jobs TO authenticated;
