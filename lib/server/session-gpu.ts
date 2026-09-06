import { setReplicateSessionGpu } from '@/lib/ml/replicate';
import { sessionGpuShouldSleep } from '@/lib/ml/session-gpu';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Shopper submit path. Failure must not block dispatch — the prediction can
 * still cold-start on gpu-a100-large.
 */
export async function warmGpuForShopperSubmit(): Promise<void> {
  await setReplicateSessionGpu('warm');
}

export async function holdGpuForFitJob(jobId: string, holdMs: number): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from('fit_jobs')
    .update({ gpu_hold_until: new Date(Date.now() + holdMs).toISOString() })
    .eq('id', jobId);

  if (error) {
    return;
  }
}

export async function releaseGpuHoldForFitJob(jobId: string): Promise<void> {
  const supabase = createServiceClient();
  await supabase.from('fit_jobs').update({ gpu_hold_until: null }).eq('id', jobId);
}

/**
 * Sleep the Deployment when no body job is pending/processing and no drape
 * hold is still active. Do not sleep after HMR success — Newton uses the
 * same warm A100.
 */
export async function sleepGpuIfNoActiveFitJobs(): Promise<void> {
  const supabase = createServiceClient();
  const { count: activeBodyJobCount, error: activeError } = await supabase
    .from('fit_jobs')
    .select('id', { count: 'exact', head: true })
    .in('status', ['pending', 'processing']);

  if (activeError) {
    return;
  }

  const { count: holdCount, error: holdError } = await supabase
    .from('fit_jobs')
    .select('id', { count: 'exact', head: true })
    .gt('gpu_hold_until', new Date().toISOString());

  const activeDrapeHoldCount = holdError ? 0 : (holdCount ?? 0);
  if (
    !sessionGpuShouldSleep({
      activeBodyJobCount: activeBodyJobCount ?? 0,
      activeDrapeHoldCount,
    })
  ) {
    return;
  }

  await setReplicateSessionGpu('sleep');
}
