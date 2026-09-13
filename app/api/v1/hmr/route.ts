import { after } from 'next/server';

import { modalCallIdForJob, runBodyPrediction } from '@/lib/ml/gpu';
import { FITTING_ROOM_AT_CAPACITY_MESSAGE } from '@/lib/ml/session-gpu';
import { watchShopperGpuDeadline } from '@/lib/server/abort-shopper-gpu';
import { applyHmrPredictionToFitJob } from '@/lib/server/apply-hmr-prediction';
import {
  parseBiometricJobImagePath,
  purgeBiometricJobImages,
} from '@/lib/server/biometrics-wipe';
import { consumeRateLimit } from '@/lib/server/durable-rate-limit';
import { parseAnnyFitDispatchRequest, isValidAnnyFitDispatch } from '@/lib/server/hmr-request';
import { RATE_LIMITS, RATE_LIMIT_WINDOW_MS } from '@/lib/server/rate-limit';
import { resolveRequestTenantId } from '@/lib/server/request-tenant';
import {
  convertWarmupLeaseToJob,
  FittingRoomAtCapacityError,
  readShopperGpuOccupancy,
  scaleShopperGpuToOccupancy,
  settleWarmReplicaIfNeeded,
  sleepGpuIfNoActiveFitJobs,
} from '@/lib/server/session-gpu';
import { createServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  }

  const body = parseAnnyFitDispatchRequest(payload);
  if (!body || !isValidAnnyFitDispatch(body)) {
    return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  }

  const frontPath = parseBiometricJobImagePath(body.frontImagePath);
  const sidePath = parseBiometricJobImagePath(body.sideImagePath);
  if (!frontPath || !sidePath) {
    return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  }

  let tenantId: string;
  try {
    tenantId = await resolveRequestTenantId(request);
  } catch {
    return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  }

  if (
    frontPath.tenantId !== tenantId
    || sidePath.tenantId !== tenantId
    || sidePath.jobId !== frontPath.jobId
  ) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const rateLimit = await consumeRateLimit(
    `hmr:${tenantId}`,
    RATE_LIMITS.hmrDispatch,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!rateLimit.allowed) {
    return Response.json({ code: 'RATE_LIMIT_EXCEEDED' }, { status: 429 });
  }

  const convertedLease = await convertWarmupLeaseToJob(tenantId, body.gpuSessionKey);
  if (!convertedLease) {
    const occupancy = await readShopperGpuOccupancy();
    if (occupancy.occupancy >= occupancy.cap) {
      return Response.json(
        { code: 'FITTING_ROOM_AT_CAPACITY', message: FITTING_ROOM_AT_CAPACITY_MESSAGE },
        { status: 409 },
      );
    }
  }

  const serviceClient = createServiceClient();
  const [frontObject, sideObject] = await Promise.all([
    serviceClient.storage.from('biometrics').download(body.frontImagePath),
    serviceClient.storage.from('biometrics').download(body.sideImagePath),
  ]);

  if (frontObject.error || !frontObject.data || sideObject.error || !sideObject.data) {
    void sleepGpuIfNoActiveFitJobs();
    return Response.json({ code: 'BIOMETRIC_ASSET_UNAVAILABLE' }, { status: 404 });
  }

  let frontImageB64: string;
  let sideImageB64: string;
  try {
    const [frontBytes, sideBytes] = await Promise.all([
      frontObject.data.arrayBuffer(),
      sideObject.data.arrayBuffer(),
    ]);
    frontImageB64 = Buffer.from(frontBytes).toString('base64');
    sideImageB64 = Buffer.from(sideBytes).toString('base64');
  } catch {
    void sleepGpuIfNoActiveFitJobs();
    return Response.json({ code: 'BIOMETRIC_ASSET_UNAVAILABLE' }, { status: 502 });
  }

  const { data: job, error: createError } = await serviceClient
    .from('fit_jobs')
    .insert({
      id: frontPath.jobId,
      tenant_id: tenantId,
      status: 'pending',
      height_cm: body.heightCm,
      sex: body.sex,
      weight_kg: body.weightKg ?? null,
      front_image_path: body.frontImagePath,
      side_image_path: body.sideImagePath,
    })
    .select('id, created_at')
    .single();

  if (createError || !job) {
    void sleepGpuIfNoActiveFitJobs();
    return Response.json({ code: 'JOB_CREATION_FAILED' }, { status: 500 });
  }

  try {
    await scaleShopperGpuToOccupancy();
    await settleWarmReplicaIfNeeded(convertedLease);
  } catch (error) {
    if (error instanceof FittingRoomAtCapacityError) {
      await serviceClient.from('fit_jobs').delete().eq('id', job.id);
      return Response.json(
        { code: 'FITTING_ROOM_AT_CAPACITY', message: FITTING_ROOM_AT_CAPACITY_MESSAGE },
        { status: 409 },
      );
    }

    const wasPurged = await purgeBiometricJobImages(
      body.frontImagePath,
      body.sideImagePath,
    );
    await serviceClient
      .from('fit_jobs')
      .update({
        status: 'failed',
        front_image_path: wasPurged ? null : body.frontImagePath,
        side_image_path: wasPurged ? null : body.sideImagePath,
        error_message: wasPurged
          ? 'Unable to start the fitting GPU.'
          : 'Unable to start the fitting GPU or purge biometric source images.',
      })
      .eq('id', job.id)
      .eq('tenant_id', tenantId);
    void sleepGpuIfNoActiveFitJobs();
    return Response.json({ job_id: job.id, status: 'failed' }, { status: 502 });
  }

  const callId = modalCallIdForJob(job.id);
  const { error: processingError } = await serviceClient
    .from('fit_jobs')
    .update({
      status: 'processing',
      replicate_prediction_id: callId,
    })
    .eq('id', job.id)
    .eq('tenant_id', tenantId);

  if (processingError) {
    const wasPurged = await purgeBiometricJobImages(
      body.frontImagePath,
      body.sideImagePath,
    );
    await serviceClient
      .from('fit_jobs')
      .update({
        status: 'failed',
        front_image_path: wasPurged ? null : body.frontImagePath,
        side_image_path: wasPurged ? null : body.sideImagePath,
        error_message: wasPurged
          ? 'Unable to start the live body prediction.'
          : 'Unable to start the live body prediction or purge biometric source images.',
      })
      .eq('id', job.id)
      .eq('tenant_id', tenantId);

    void sleepGpuIfNoActiveFitJobs();
    return Response.json({ job_id: job.id, status: 'pending' }, { status: 500 });
  }

  after(() => {
    void watchShopperGpuDeadline(job.id);
    void (async () => {
      const startedAt = new Date().toISOString();
      const jobRow = {
        replicate_prediction_id: callId,
        front_image_path: body.frontImagePath,
        side_image_path: body.sideImagePath,
        created_at: job.created_at,
        weight_kg: body.weightKg ?? null,
      };

      try {
        const output = await runBodyPrediction({
          frontImageB64,
          sideImageB64,
          heightCm: body.heightCm,
          sex: body.sex,
          weightKg: body.weightKg,
        });
        await applyHmrPredictionToFitJob(
          job.id,
          {
            id: callId,
            status: 'succeeded',
            output,
            error: null,
            startedAt,
          },
          jobRow,
        );
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : 'Unable to dispatch the live body prediction.';
        try {
          await applyHmrPredictionToFitJob(
            job.id,
            {
              id: callId,
              status: 'failed',
              output: null,
              error: message,
              startedAt,
            },
            jobRow,
          );
        } catch {
          const wasPurged = await purgeBiometricJobImages(
            body.frontImagePath,
            body.sideImagePath,
          );
          await serviceClient
            .from('fit_jobs')
            .update({
              status: 'failed',
              front_image_path: wasPurged ? null : body.frontImagePath,
              side_image_path: wasPurged ? null : body.sideImagePath,
              error_message: wasPurged
                ? message
                : `${message} Biometric photos could not be purged.`,
            })
            .eq('id', job.id)
            .eq('tenant_id', tenantId)
            .in('status', ['pending', 'processing']);
          void sleepGpuIfNoActiveFitJobs();
        }
      }
    })();
  });

  return Response.json({ job_id: job.id, status: 'pending' }, { status: 202 });
}
