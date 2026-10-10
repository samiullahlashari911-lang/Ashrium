-- What each try-on showed the shopper: the garment and size tried, what the
-- drape returned (drawn, too tight, quality failed, no 3D, out of time) and
-- whether the garment was actually drawn on their photo. Labels only: no
-- photos, no body data, so it outlives the phenotype TTL like other job data.
ALTER TABLE public.fit_jobs
  ADD COLUMN IF NOT EXISTS try_on_outcome jsonb;

COMMENT ON COLUMN public.fit_jobs.try_on_outcome IS
  'Non-biometric try-on outcome log: {attempts: [{at, sku, size, drape, shown}]}.';
