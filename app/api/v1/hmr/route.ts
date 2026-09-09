import { after } from 'next/server';

import {
  parseBiometricJobImagePath,
  purgeBiometricJobImages,
} from '@/lib/server/biometrics-wipe';
import { consumeRateLimit } from '@/lib/server/durable-rate-limit';
import { BIOMETRIC_SIGNED_READ_SECONDS } from '@/lib/server/biometric-upload';
import { parseAnnyFitDispatchRequest, isValidAnnyFitDispatch } from '@/lib/server/hmr-request';
import { RATE_LIMITS, RATE_LIMIT_WINDOW_MS } from '@/lib/server/rate-limit';
import { resolveRequestTenantId } from '@/lib/server/request-tenant';
import { createServiceClient } from '@/lib/supabase/service';
import { dispatchAnnyFitPrediction } from '@/lib/ml/replicate';
import { GPU_COLD_START_WAIT_MS } from '@/lib/ml/session-gpu';
import { watchShopperGpuDeadline } from '@/lib/server/abort-shopper-gpu';
import { sleepGpuIfNoActiveFitJobs, warmAndWaitForShopperGpu } from '@/lib/server/session-gpu';

function getWebhookBaseUrl(): URL {
  const appBaseUrl = process.env.APP_BASE_URL?.trim();

  if (!appBaseUrl) {
    throw new Error('APP_BASE_URL is required for live Replicate webhooks.');
  }

  const parsedUrl = new URL(appBaseUrl);
  if (parsedUrl.protocol !== 'https:') {
    throw new Error('APP_BASE_URL must use HTTPS for live Replicate webhooks.');
  }

  return parsedUrl;
}

export const runtime = 'nodejs';
export const maxDuration = 130;

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

  if (frontPath.tenantId !== tenantId) {
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

  const serviceClient = createServiceClient();
  const warmGpu = Promise.race([
    warmAndWaitForShopperGpu(GPU_COLD_START_WAIT_MS),
    new Promise<void>((resolve) => {
      setTimeout(resolve, GPU_COLD_START_WAIT_MS + 3_000);
    }),
  ]).catch(() => {
    // Dispatch still runs; the Deployment can cold-start under the 2-minute cap.
  });

  const [signedFront, signedSide] = await Promise.all([
    serviceClient.storage.from('biometrics').createSignedUrl(
      body.frontImagePath,
      BIOMETRIC_SIGNED_READ_SECONDS,
    ),
    serviceClient.storage.from('biometrics').createSignedUrl(
      body.sideImagePath,
      BIOMETRIC_SIGNED_READ_SECONDS,
    ),
  ]);

  if (signedFront.error || !signedFront.data || signedSide.error || !signedSide.data) {
    await warmGpu;
    void sleepGpuIfNoActiveFitJobs();
    return Response.json({ code: 'BIOMETRIC_ASSET_UNAVAILABLE' }, { status: 404 });
  }

  await warmGpu;

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
    .select('id')
    .single();

  if (createError || !job) {
    void sleepGpuIfNoActiveFitJobs();
    return Response.json({ code: 'JOB_CREATION_FAILED' }, { status: 500 });
  }

  const { error: processingError } = await serviceClient
    .from('fit_jobs')
    .update({ status: 'processing' })
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

  try {
    const webhookUrl = new URL('/api/v1/webhooks/replicate', getWebhookBaseUrl());
    webhookUrl.searchParams.set('job_id', job.id);
    const prediction = await dispatchAnnyFitPrediction({
      frontImageUrl: signedFront.data.signedUrl,
      sideImageUrl: signedSide.data.signedUrl,
      heightCm: body.heightCm,
      sex: body.sex,
      weightKg: body.weightKg,
      webhookUrl: webhookUrl.toString(),
    });

    const { error: dispatchUpdateError } = await serviceClient
      .from('fit_jobs')
      .update({ replicate_prediction_id: prediction.id })
      .eq('id', job.id)
      .eq('tenant_id', tenantId);

    if (dispatchUpdateError) {
      throw new Error('Unable to associate the Replicate prediction with the fit job.');
    }

    after(() => {
      void watchShopperGpuDeadline(job.id);
    });
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
          ? 'Unable to dispatch the live body prediction.'
          : 'Unable to dispatch the live body prediction or purge biometric source images.',
      })
      .eq('id', job.id)
      .eq('tenant_id', tenantId);

    void sleepGpuIfNoActiveFitJobs();
    return Response.json({ job_id: job.id, status: 'failed' }, { status: 502 });
  }

  return Response.json({ job_id: job.id, status: 'pending' }, { status: 202 });
}
