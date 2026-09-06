-- Keep the shared A100 Deployment warm after task=body so task=drape
-- does not cold-start. Sleep only when no body job is active and no hold
-- is still in the future.

ALTER TABLE public.fit_jobs
  ADD COLUMN IF NOT EXISTS gpu_hold_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS fit_jobs_gpu_hold_until_idx
  ON public.fit_jobs (gpu_hold_until)
  WHERE gpu_hold_until IS NOT NULL;

COMMENT ON COLUMN public.fit_jobs.gpu_hold_until IS
  'Session GPU hold. After HMR success, keep min_instances=1 until Newton drape finishes or this timestamp passes.';
