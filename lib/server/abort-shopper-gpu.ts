import { cancelReplicatePrediction, fetchReplicatePrediction } from '@/lib/ml/replicate';
import {
  SHOPPER_GPU_TIMEOUT_MESSAGE,
  SHOPPER_GPU_WARMUP_IDLE_MS,
  isShopperInferenceOverdue,
  shopperGpuActiveLookbackMs,
} from '@/lib/ml/session-gpu';
import {
  applyHmrPredictionToFitJob,
  isTerminalReplicateStatus,
} from '@/lib/server/apply-hmr-prediction';
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
  weight_kg: number | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function cancelPredictionWithRetry(predictionId: string | null): Promise<void> {
  if (typeof predictionId !== 'string' || predictionId.length === 0) {
    return;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await cancelReplicatePrediction(predictionId);
      return;
    } catch {
      if (attempt === 2) {
        return;
      }
      await sleep(400);
    }
  }
}

export async function abortShopperFitJob(job: AbortableFitJob): Promise<boolean> {
  if (job.status !== 'pending' && job.status !== 'processing') {
    await cancelPredictionWithRetry(job.replicate_prediction_id);
    await sleepGpuIfNoActiveFitJobs();
    return false;
  }

  await cancelPredictionWithRetry(job.replicate_prediction_id);

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
  const { data, error } = await supabase
    .from('fit_jobs')
    .select(
      'id, tenant_id, status, created_at, replicate_prediction_id, front_image_path, side_image_path, weight_kg',
    )
    .in('status', [...ACTIVE_STATUSES])
    .order('created_at', { ascending: true })
    .limit(50);

  if (error || !data) {
    return 0;
  }

  let aborted = 0;
  for (const row of data) {
    if (await abortFitJobIfOverdue((row as AbortableFitJob).id)) {
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
      'id, tenant_id, status, created_at, replicate_prediction_id, front_image_path, side_image_path, weight_kg',
    )
    .eq('id', jobId)
    .maybeSingle();

  if (error || !data) {
    return false;
  }

  const job = data as AbortableFitJob;
  if (job.status !== 'pending' && job.status !== 'processing') {
    return false;
  }

  let startedAt: string | null = null;
  let predictionStatus: string | null = null;
  if (job.replicate_prediction_id) {
    try {
      const prediction = await fetchReplicatePrediction(job.replicate_prediction_id);
      startedAt = prediction.startedAt;
      predictionStatus = prediction.status;
      if (isTerminalReplicateStatus(prediction.status)) {
        try {
          await applyHmrPredictionToFitJob(job.id, prediction, job);
        } catch {
          // Webhook or status can retry. Never timeout-abort a finished Cog run.
        }
        return false;
      }
    } catch {
      // Replicate lookup failed; fall through to the wall-clock check.
    }
  }

  if (!isShopperInferenceOverdue(job.created_at, Date.now(), startedAt, predictionStatus)) {
    return false;
  }

  return abortShopperFitJob(job);
}

export async function abortShopperFitJobById(
  jobId: string,
  tenantId?: string,
): Promise<boolean> {
  const supabase = createServiceClient();
  let query = supabase
    .from('fit_jobs')
    .select(
      'id, tenant_id, status, created_at, replicate_prediction_id, front_image_path, side_image_path, weight_kg',
    )
    .eq('id', jobId);

  if (tenantId) {
    query = query.eq('tenant_id', tenantId);
  }

  const { data, error } = await query.maybeSingle();
  if (error || !data) {
    return false;
  }

  return abortShopperFitJob(data as AbortableFitJob);
}

/**
 * UI/timeout can mark a job failed while the Cog is still billed. Cancel those
 * leftover predictions, then sleep idle replicas.
 */
export async function cancelPredictionsForRecentlyFailedJobs(): Promise<number> {
  const supabase = createServiceClient();
  const cutoff = new Date(Date.now() - shopperGpuActiveLookbackMs()).toISOString();
  const { data, error } = await supabase
    .from('fit_jobs')
    .select('replicate_prediction_id')
    .eq('status', 'failed')
    .not('replicate_prediction_id', 'is', null)
    .gt('updated_at', cutoff)
    .limit(50);

  if (error || !data) {
    return 0;
  }

  const ids = Array.from(
    new Set(
      data
        .map((row) => row.replicate_prediction_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  );

  for (const predictionId of ids) {
    await cancelPredictionWithRetry(predictionId);
  }

  return ids.length;
}

export async function reconcileShopperGpu(): Promise<{
  aborted: number;
  canceledFailed: number;
}> {
  let aborted = 0;
  try {
    aborted = await abortOverdueShopperFitJobs();
  } catch {
    aborted = 0;
  }

  let canceledFailed = 0;
  try {
    canceledFailed = await cancelPredictionsForRecentlyFailedJobs();
  } catch {
    canceledFailed = 0;
  }

  try {
    await sleepGpuIfNoActiveFitJobs();
  } catch {
    // Idle sleep must not throw into cron / after().
  }

  return { aborted, canceledFailed };
}

/**
 * Stays attached to POST /api/v1/hmr so a closed widget cannot leave the A100
 * billed. A daily gpu-guard cron is a last-resort sweeper; closing the widget
 * or any capture error cancels the prediction immediately.
 */
export async function watchShopperGpuDeadline(jobId: string): Promise<void> {
  const supabase = createServiceClient();
  const watchStarted = Date.now();
  const functionGuardMs = 280_000;

  while (Date.now() - watchStarted < functionGuardMs) {
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

    const aborted = await abortFitJobIfOverdue(jobId);
    if (aborted) {
      return;
    }
  }

  await abortFitJobIfOverdue(jobId);
}

/**
 * Capture warmup can scale the A100 before a fit job exists. Sleep it if
 * the shopper never submits.
 */
export async function watchWarmGpuIdleTimeout(): Promise<void> {
  await sleep(SHOPPER_GPU_WARMUP_IDLE_MS);
  await reconcileShopperGpu();
}
