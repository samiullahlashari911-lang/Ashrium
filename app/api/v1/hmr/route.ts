import {
  dispatchHmrPrediction,
  isReplicateMockMode,
  runHmrEstimation,
} from '@/lib/ml/replicate';
import { isBiometricAssetPath, purgeBiometricAsset } from '@/lib/server/biometrics-wipe';
import { createServiceClient } from '@/lib/supabase/service';
import { requireCurrentTenantId } from '@/lib/supabase/tenant';
import type { Json } from '@/types/database';
import type { SmplxParameters } from '@/types/hmr';

interface HmrDispatchRequest {
  filePath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isHmrDispatchRequest(value: unknown): value is HmrDispatchRequest {
  return isRecord(value) && typeof value.filePath === 'string' && value.filePath.length > 0;
}

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

function smplxParametersToJson(parameters: SmplxParameters): Json {
  return {
    betas: parameters.betas,
    pose: parameters.pose,
    trans: parameters.trans,
    mesh: {
      vertices: parameters.mesh.vertices,
      faces: parameters.mesh.faces,
    },
  };
}

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  }

  if (!isHmrDispatchRequest(payload) || !isBiometricAssetPath(payload.filePath)) {
    return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  }

  let tenantId: string;
  try {
    tenantId = await requireCurrentTenantId();
  } catch {
    return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  }

  if (!payload.filePath.startsWith(`${tenantId}/`)) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const serviceClient = createServiceClient();
  const { data: signedImage, error: signedImageError } = await serviceClient.storage
    .from('biometrics')
    .createSignedUrl(payload.filePath, 60);

  if (signedImageError || !signedImage) {
    return Response.json({ code: 'BIOMETRIC_ASSET_UNAVAILABLE' }, { status: 404 });
  }

  const { data: job, error: createError } = await serviceClient
    .from('fit_jobs')
    .insert({
      tenant_id: tenantId,
      status: 'pending',
      input_image_url: payload.filePath,
    })
    .select('id')
    .single();

  if (createError || !job) {
    return Response.json({ code: 'JOB_CREATION_FAILED' }, { status: 500 });
  }

  const { error: processingError } = await serviceClient
    .from('fit_jobs')
    .update({ status: 'processing' })
    .eq('id', job.id)
    .eq('tenant_id', tenantId);

  if (processingError) {
    const wasPurged = await purgeBiometricAsset(payload.filePath);
    await serviceClient
      .from('fit_jobs')
      .update({
        status: 'failed',
        input_image_url: wasPurged ? null : payload.filePath,
        error_message: wasPurged
          ? 'Unable to start HMR prediction.'
          : 'Unable to start HMR prediction or purge biometric source image.',
      })
      .eq('id', job.id)
      .eq('tenant_id', tenantId);

    return Response.json({ job_id: job.id, status: 'pending' }, { status: 500 });
  }

  if (isReplicateMockMode()) {
    try {
      const mockResult = await runHmrEstimation({ imageUrl: signedImage.signedUrl });
      const wasPurged = await purgeBiometricAsset(payload.filePath);

      await serviceClient
        .from('fit_jobs')
        .update({
          status: wasPurged ? 'completed' : 'failed',
          input_image_url: wasPurged ? null : payload.filePath,
          smplx_params: wasPurged ? smplxParametersToJson(mockResult) : null,
          error_message: wasPurged ? null : 'Unable to purge biometric source image.',
        })
        .eq('id', job.id)
        .eq('tenant_id', tenantId);

      return Response.json({ job_id: job.id, status: 'pending' });
    } catch {
      const wasPurged = await purgeBiometricAsset(payload.filePath);

      await serviceClient
        .from('fit_jobs')
        .update({
          status: 'failed',
          input_image_url: wasPurged ? null : payload.filePath,
          error_message: wasPurged
            ? 'Unable to run mock HMR prediction.'
            : 'Unable to run mock HMR prediction or purge biometric source image.',
        })
        .eq('id', job.id)
        .eq('tenant_id', tenantId);

      return Response.json({ job_id: job.id, status: 'failed' }, { status: 502 });
    }
  }

  try {
    const webhookUrl = new URL('/api/v1/webhooks/replicate', getWebhookBaseUrl());
    webhookUrl.searchParams.set('job_id', job.id);
    const prediction = await dispatchHmrPrediction({
      imageUrl: signedImage.signedUrl,
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
  } catch {
    const wasPurged = await purgeBiometricAsset(payload.filePath);

    await serviceClient
      .from('fit_jobs')
      .update({
        status: 'failed',
        input_image_url: wasPurged ? null : payload.filePath,
        error_message: wasPurged
          ? 'Unable to dispatch HMR prediction.'
          : 'Unable to dispatch HMR prediction or purge biometric source image.',
      })
      .eq('id', job.id)
      .eq('tenant_id', tenantId);

    return Response.json({ job_id: job.id, status: 'failed' }, { status: 502 });
  }

  return Response.json({ job_id: job.id, status: 'pending' }, { status: 202 });
}
