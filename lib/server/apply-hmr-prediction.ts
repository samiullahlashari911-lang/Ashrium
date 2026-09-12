import { parseMhrParametricVector } from '@/lib/ml/replicate';
import { gpuHoldMsUntilDeadline } from '@/lib/ml/session-gpu';
import { purgeBiometricJobImages } from '@/lib/server/biometrics-wipe';
import {
  holdGpuForFitJob,
  releaseGpuHoldForFitJob,
  sleepGpuIfNoActiveFitJobs,
} from '@/lib/server/session-gpu';
import { createServiceClient } from '@/lib/supabase/service';
import type { Json } from '@/types/database';
import type { MhrParametricVector } from '@/types/hmr';

export const PARAMETRIC_RESULT_TTL_MS = 15 * 60 * 1000;

export interface HmrPredictionSnapshot {
  id: string;
  status: string;
  output: unknown;
  error: string | null;
  startedAt?: string | null;
}

export interface FitJobHmrRow {
  replicate_prediction_id: string | null;
  front_image_path: string | null;
  side_image_path: string | null;
  created_at: string;
  weight_kg: number | null;
}

export class HmrJobApplyError extends Error {
  readonly code: 'PURGE_FAILED' | 'SAVE_FAILED';

  constructor(message: string, code: 'PURGE_FAILED' | 'SAVE_FAILED') {
    super(message);
    this.name = 'HmrJobApplyError';
    this.code = code;
  }
}

export function isTerminalReplicateStatus(status: string): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'canceled';
}

function toJson(value: MhrParametricVector): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

/**
 * Shared write path for the Replicate webhook and status-route reconcile.
 * Wipes biometrics on any terminal prediction, then stores MHR params or the
 * real parse / Replicate error. Does not invent a phenotype.
 */
export async function applyHmrPredictionToFitJob(
  jobId: string,
  prediction: HmrPredictionSnapshot,
  job: FitJobHmrRow,
): Promise<{ applied: boolean }> {
  if (!job.replicate_prediction_id || job.replicate_prediction_id !== prediction.id) {
    return { applied: false };
  }

  if (!isTerminalReplicateStatus(prediction.status)) {
    return { applied: false };
  }

  const serviceClient = createServiceClient();
  const wasPurged = await purgeBiometricJobImages(
    job.front_image_path,
    job.side_image_path,
  );

  if (!wasPurged) {
    throw new HmrJobApplyError('Unable to purge biometric source images.', 'PURGE_FAILED');
  }

  if (prediction.status === 'succeeded') {
    try {
      const parametricResult = parseMhrParametricVector(
        prediction.output,
        job.weight_kg ?? undefined,
      );
      const inferenceDurationMs = Math.max(
        0,
        Date.now() - new Date(job.created_at).getTime(),
      );

      const { error: updateError } = await serviceClient
        .from('fit_jobs')
        .update({
          status: 'completed',
          front_image_path: null,
          side_image_path: null,
          parametric_result: toJson(parametricResult),
          parametric_result_expires_at: new Date(
            Date.now() + PARAMETRIC_RESULT_TTL_MS,
          ).toISOString(),
          inference_duration_ms: inferenceDurationMs,
          error_message: null,
        })
        .eq('id', jobId);

      if (updateError) {
        throw new HmrJobApplyError('Unable to save fit job output.', 'SAVE_FAILED');
      }

      const holdMs = gpuHoldMsUntilDeadline(job.created_at, Date.now(), prediction.startedAt);
      if (holdMs > 0) {
        await holdGpuForFitJob(jobId, holdMs);
      } else {
        await releaseGpuHoldForFitJob(jobId);
        void sleepGpuIfNoActiveFitJobs();
      }
      return { applied: true };
    } catch (error) {
      if (error instanceof HmrJobApplyError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : 'MHR Cog output was invalid.';
      // #region agent log
      fetch('http://127.0.0.1:7718/ingest/5c6f4191-5d6f-487b-adb7-f441fc4ce685',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'06d10c'},body:JSON.stringify({sessionId:'06d10c',runId:'pre-fix',hypothesisId:'H4',location:'lib/server/apply-hmr-prediction.ts:applyHmrPredictionToFitJob',message:'MHR parse failed',data:{jobId,error:message.slice(0,180)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      const { error: updateError } = await serviceClient
        .from('fit_jobs')
        .update({
          status: 'failed',
          front_image_path: null,
          side_image_path: null,
          error_message: message,
        })
        .eq('id', jobId);

      if (updateError) {
        throw new HmrJobApplyError('Unable to save fit job failure.', 'SAVE_FAILED');
      }

      await releaseGpuHoldForFitJob(jobId);
      void sleepGpuIfNoActiveFitJobs();
      return { applied: true };
    }
  }

  const { error: updateError } = await serviceClient
    .from('fit_jobs')
    .update({
      status: 'failed',
      front_image_path: null,
      side_image_path: null,
      error_message: prediction.error ?? `Replicate prediction ${prediction.status}.`,
    })
    .eq('id', jobId);

  if (updateError) {
    throw new HmrJobApplyError('Unable to save fit job failure.', 'SAVE_FAILED');
  }

  await releaseGpuHoldForFitJob(jobId);
  void sleepGpuIfNoActiveFitJobs();
  return { applied: true };
}
