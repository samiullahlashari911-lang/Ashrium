import { cancelReplicatePrediction } from '@/lib/ml/replicate';
import {
  SHOPPER_GPU_TIMEOUT_MESSAGE,
  SHOPPER_GPU_WARMUP_IDLE_MS,
  SHOPPER_INFERENCE_DEADLINE_MS,
  isShopperInferenceOverdue,
} from '@/lib/ml/session-gpu';
import { purgeBiometricJobImages } from '@/lib/server/biometrics-wipe';
import {
  releaseGpuHoldForFitJob,
  sleepGpuIfNoActiveFitJobs,
} from '@/lib/server/session-gpu';
import { createServiceClient } from '@/lib/supabase/service';

const ACTIVE_STATUSES = ['pending', 'processing'] as const;

interface AbortableFitJob {
  id: string;
  tenant_id: string;
  status: string;
  created_at: string;
  replicate_prediction_id: string | null;
  front_image_path: string | null;
  side_image_path: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function abortShopperFitJob(job: AbortableFitJob): Promise<boolean> {
  if (job.status !== 'pending' && job.status !== 'processing') {
    return false;
  }

  if (typeof job.replicate_prediction_id === 'string' && job.replicate_prediction_id.length > 0) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await cancelReplicatePrediction(job.replicate_prediction_id);
        break;
      } catch {
        if (attempt === 2) {
          break;
        }
        await sleep(400);
      }
    }
  }

  const wasPurged = await purgeBiometricJobImages(job.front_image_path, job.side_image_path);
  const supabase = createServiceClient();
  const { error } = await supabase
    .from('fit_jobs')
    .update({
      status: 'failed',
      front_image_path: null,
      side_image_path: null,
      error_message: wasPurged
        ? SHOPPER_GPU_TIMEOUT_MESSAGE
        : `${SHOPPER_GPU_TIMEOUT_MESSAGE} Biometric photos could not be purged.`,
    })
    .eq('id', job.id)
    .eq('tenant_id', job.tenant_id)
    .in('status', [...ACTIVE_STATUSES]);

  if (error) {
    return false;
  }

  await releaseGpuHoldForFitJob(job.id);
  await sleepGpuIfNoActiveFitJobs();
  return true;
}

export async function abortOverdueShopperFitJobs(): Promise<number> {
  const supabase = createServiceClient();
  const cutoff = new Date(Date.now() - SHOPPER_INFERENCE_DEADLINE_MS).toISOString();
  const { data, error } = await supabase
    .from('fit_jobs')
    .select(
      'id, tenant_id, status, created_at, replicate_prediction_id, front_image_path, side_image_path',
    )
    .in('status', [...ACTIVE_STATUSES])
    .lte('created_at', cutoff);

  if (error || !data) {
    return 0;
  }

  let aborted = 0;
  for (const row of data) {
    const job = row as AbortableFitJob;
    if (!isShopperInferenceOverdue(job.created_at)) {
      continue;
    }
    if (await abortShopperFitJob(job)) {
      aborted += 1;
    }
  }

  return aborted;
}

export async function abortFitJobIfOverdue(jobId: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('fit_jobs')
    .select(
      'id, tenant_id, status, created_at, replicate_prediction_id, front_image_path, side_image_path',
    )
    .eq('id', jobId)
    .maybeSingle();

  if (error || !data) {
    return false;
  }

  const job = data as AbortableFitJob;
  if (!isShopperInferenceOverdue(job.created_at)) {
    return false;
  }

  return abortShopperFitJob(job);
}

/**
 * Stays attached to POST /api/v1/hmr so a closed widget cannot leave the A100
 * billed. Sleeps the Deployment at the 2-minute wall clock.
 */
export async function watchShopperGpuDeadline(jobId: string): Promise<void> {
  const supabase = createServiceClient();
  const { data: job } = await supabase
    .from('fit_jobs')
    .select('id, created_at, status')
    .eq('id', jobId)
    .maybeSingle();

  if (!job) {
    return;
  }

  const deadline = Date.parse(job.created_at) + SHOPPER_INFERENCE_DEADLINE_MS;
  while (Date.now() < deadline) {
    await sleep(4000);
    const { data: latest } = await supabase
      .from('fit_jobs')
      .select('status')
      .eq('id', jobId)
      .maybeSingle();

    if (!latest) {
      return;
    }

    if (latest.status !== 'pending' && latest.status !== 'processing') {
      return;
    }
  }

  try {
    await abortFitJobIfOverdue(jobId);
    await releaseGpuHoldForFitJob(jobId);
    await sleepGpuIfNoActiveFitJobs();
  } catch {
    try {
      await sleepGpuIfNoActiveFitJobs();
    } catch {
      // Last resort already attempted.
    }
  }
}

/**
 * Capture warmup can scale the A100 before a fit job exists. Sleep it if
 * the shopper never submits.
 */
export async function watchWarmGpuIdleTimeout(): Promise<void> {
  await sleep(SHOPPER_GPU_WARMUP_IDLE_MS);
  try {
    await abortOverdueShopperFitJobs();
  } catch {
    // Stale jobs must not keep the idle watcher from sleeping the GPU.
  }
  try {
    await sleepGpuIfNoActiveFitJobs();
  } catch {
    // Idle watcher must not throw into after().
  }
}
