import { setReplicateSessionGpu } from '@/lib/ml/replicate';
import {
  GPU_COLD_START_WAIT_MS,
  GPU_WARM_SETTLE_WAIT_MS,
  SHOPPER_INFERENCE_DEADLINE_MS,
  sessionGpuShouldSleep,
} from '@/lib/ml/session-gpu';
import { createServiceClient } from '@/lib/supabase/service';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Shopper submit path. Failure must not block dispatch — the prediction can
 * still cold-start on gpu-a100-large.
 */
export async function warmGpuForShopperSubmit(): Promise<void> {
  await setReplicateSessionGpu('warm');
}

/**
 * PATCH min_instances=1. If this call actually scaled 0→1, wait so Cog
 * setup() can finish before the first prediction is queued.
 */
export async function warmAndWaitForShopperGpu(maxWaitMs = GPU_COLD_START_WAIT_MS): Promise<void> {
  const started = Date.now();
  const result = await setReplicateSessionGpu('warm');
  const budget = result.minInstancesUpdated
    ? Math.max(0, Math.min(GPU_COLD_START_WAIT_MS, maxWaitMs))
    : Math.max(0, Math.min(GPU_WARM_SETTLE_WAIT_MS, maxWaitMs));
  const remaining = budget - (Date.now() - started);
  if (remaining > 0) {
    await sleep(remaining);
  }
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
  const cutoff = new Date(Date.now() - SHOPPER_INFERENCE_DEADLINE_MS).toISOString();
  const { count: activeBodyJobCount, error: activeError } = await supabase
    .from('fit_jobs')
    .select('id', { count: 'exact', head: true })
    .in('status', ['pending', 'processing'])
    .gt('created_at', cutoff);

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
