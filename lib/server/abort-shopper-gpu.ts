import { cancelReplicatePrediction, fetchReplicatePrediction } from '@/lib/ml/replicate';
import {
  SHOPPER_GPU_TIMEOUT_MESSAGE,
  SHOPPER_GPU_WARMUP_IDLE_MS,
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
  // #region agent log
  fetch('http://127.0.0.1:7718/ingest/5c6f4191-5d6f-487b-adb7-f441fc4ce685',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'06d10c'},body:JSON.stringify({sessionId:'06d10c',runId:'pre-fix',hypothesisId:'H1',location:'lib/server/abort-shopper-gpu.ts:abortShopperFitJob',message:'job aborted at GPU wall',data:{jobId:job.id,ageMs:Date.now()-Date.parse(job.created_at),hadPrediction:Boolean(job.replicate_prediction_id)},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  return true;
}

async function readInferenceStartedAt(predictionId: string | null): Promise<{
  startedAt: string | null;
  status: string | null;
}> {
  if (!predictionId) {
    return { startedAt: null, status: null };
  }

  try {
    const prediction = await fetchReplicatePrediction(predictionId);
    return { startedAt: prediction.startedAt, status: prediction.status };
  } catch {
    return { startedAt: null, status: null };
  }
}

export async function abortOverdueShopperFitJobs(): Promise<number> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('fit_jobs')
    .select(
      'id, tenant_id, status, created_at, replicate_prediction_id, front_image_path, side_image_path',
    )
    .in('status', [...ACTIVE_STATUSES])
    .order('created_at', { ascending: true })
    .limit(25);

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
      'id, tenant_id, status, created_at, replicate_prediction_id, front_image_path, side_image_path',
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

  const timing = await readInferenceStartedAt(job.replicate_prediction_id);
  if (timing.status === 'succeeded' || timing.status === 'failed') {
    return false;
  }

  const overdue = isShopperInferenceOverdue(job.created_at, Date.now(), timing.startedAt);
  // #region agent log
  fetch('http://127.0.0.1:7718/ingest/5c6f4191-5d6f-487b-adb7-f441fc4ce685',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'06d10c'},body:JSON.stringify({sessionId:'06d10c',runId:'post-fix',hypothesisId:'H1',location:'lib/server/abort-shopper-gpu.ts:abortFitJobIfOverdue',message:'overdue check vs Replicate started_at',data:{jobId:job.id,overdue,predictionStatus:timing.status,hasStartedAt:Boolean(timing.startedAt),ageMs:Date.now()-Date.parse(job.created_at)},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  if (!overdue) {
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
  const watchStarted = Date.now();
  // Stay under Vercel maxDuration=130. Do not sleep the GPU when this
  // function ends — Cog setup may still be finishing on Replicate.
  const functionGuardMs = 110_000;

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

  // #region agent log
  fetch('http://127.0.0.1:7718/ingest/5c6f4191-5d6f-487b-adb7-f441fc4ce685',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'06d10c'},body:JSON.stringify({sessionId:'06d10c',runId:'post-fix',hypothesisId:'H1',location:'lib/server/abort-shopper-gpu.ts:watchShopperGpuDeadline',message:'watch ended without aborting queued job',data:{jobId,elapsedMs:Date.now()-watchStarted},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
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
