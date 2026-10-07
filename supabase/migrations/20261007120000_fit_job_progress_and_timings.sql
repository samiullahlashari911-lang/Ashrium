-- Live avatar build stages (shopper loading pill) and end-to-end latency
-- timestamps for the avatar SLA (p95 ≤ 60 s warm / ≤ 180 s cold from submit).
--
-- progress_stage: last stage the Modal app reported via /api/v1/hmr/progress.
-- dispatched_at:  Vercel sent task=body to Modal.
-- gpu_started_at: first GPU stage callback (real "started", not queue time).
-- completed_at:   phenotype applied to the row.
-- None of these hold biometric data; they follow the row's normal lifecycle.

ALTER TABLE public.fit_jobs
  ADD COLUMN IF NOT EXISTS progress_stage text,
  ADD COLUMN IF NOT EXISTS progress_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS gpu_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE public.fit_jobs
  DROP CONSTRAINT IF EXISTS fit_jobs_progress_stage_check;

ALTER TABLE public.fit_jobs
  ADD CONSTRAINT fit_jobs_progress_stage_check
  CHECK (progress_stage IS NULL OR progress_stage IN ('silhouettes', 'body', 'measure'));

CREATE INDEX IF NOT EXISTS fit_jobs_completed_at_idx
  ON public.fit_jobs (tenant_id, completed_at DESC)
  WHERE completed_at IS NOT NULL;
