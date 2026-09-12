-- Concurrent shopper GPU leases plus category-incomplete size charts.
-- girths may be unpublished (NULL) so tees can persist bust+length without inventing waist/hip.

CREATE TABLE IF NOT EXISTS public.shopper_gpu_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  session_key TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shopper_gpu_sessions_session_key_length_check
    CHECK (char_length(session_key) BETWEEN 8 AND 80),
  CONSTRAINT shopper_gpu_sessions_tenant_session_unique UNIQUE (tenant_id, session_key)
);

CREATE INDEX IF NOT EXISTS shopper_gpu_sessions_expires_at_idx
  ON public.shopper_gpu_sessions (expires_at);

CREATE INDEX IF NOT EXISTS shopper_gpu_sessions_tenant_id_idx
  ON public.shopper_gpu_sessions (tenant_id);

ALTER TABLE public.shopper_gpu_sessions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.shopper_gpu_sessions IS
  'Capture warmup leases. Occupancy = live leases + pending/processing fit_jobs. Idle sleep when both are zero.';

ALTER TABLE public.garment_size_variants
  ALTER COLUMN chest_cm DROP NOT NULL,
  ALTER COLUMN waist_cm DROP NOT NULL,
  ALTER COLUMN hip_cm DROP NOT NULL,
  ALTER COLUMN length_cm DROP NOT NULL;

ALTER TABLE public.garment_size_variants
  DROP CONSTRAINT IF EXISTS garment_size_variants_measurements_check;

ALTER TABLE public.garment_size_variants
  ADD CONSTRAINT garment_size_variants_measurements_check
  CHECK (
    (chest_cm IS NULL OR chest_cm > 0)
    AND (waist_cm IS NULL OR waist_cm > 0)
    AND (hip_cm IS NULL OR hip_cm > 0)
    AND (length_cm IS NULL OR length_cm > 0)
    AND (
      chest_cm IS NOT NULL
      OR waist_cm IS NOT NULL
      OR hip_cm IS NOT NULL
      OR length_cm IS NOT NULL
    )
  );
