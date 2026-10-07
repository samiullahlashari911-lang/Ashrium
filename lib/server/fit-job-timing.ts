import { createServiceClient } from '@/lib/supabase/service';
import type { FitJobUpdate } from '@/types/database';

type FitJobTimingPatch = Pick<
  FitJobUpdate,
  'dispatched_at' | 'gpu_started_at' | 'completed_at' | 'progress_stage' | 'progress_at'
>;

/**
 * Best-effort write of latency timestamps / live stage. These are telemetry:
 * a failed write is logged and never fails the shopper's avatar.
 */
export async function recordFitJobTiming(
  jobId: string,
  tenantId: string,
  patch: FitJobTimingPatch,
): Promise<void> {
  try {
    const { error } = await createServiceClient()
      .from('fit_jobs')
      .update(patch)
      .eq('id', jobId)
      .eq('tenant_id', tenantId);
    if (error) {
      console.warn('[fit-job-timing] skipped', error.message);
    }
  } catch (error) {
    console.warn('[fit-job-timing] skipped', error instanceof Error ? error.message : error);
  }
}
