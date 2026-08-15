import { purgeBiometricAsset } from '@/lib/server/biometrics-wipe';
import { verifyReplicateWebhook } from '@/lib/server/replicate-webhook';
import { createServiceClient } from '@/lib/supabase/service';
import type { Json } from '@/types/database';

export const runtime = 'nodejs';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isJson(value: unknown): value is Json {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJson);
  }

  return isRecord(value) && Object.values(value).every(isJson);
}

function isGltfUrl(value: string): boolean {
  try {
    return new URL(value).pathname.endsWith('.gltf');
  } catch {
    return false;
  }
}

function extractGltfOutputUrl(output: unknown): string | null {
  if (typeof output === 'string') {
    return isGltfUrl(output) ? output : null;
  }

  if (Array.isArray(output)) {
    return output.find((value): value is string => typeof value === 'string' && isGltfUrl(value))
      ?? null;
  }

  if (!isRecord(output)) {
    return null;
  }

  const candidates = [output.gltf_output_url, output.gltf_url, output.gltf, output.mesh_url];
  return candidates.find(
    (value): value is string => typeof value === 'string' && isGltfUrl(value),
  ) ?? null;
}

function extractSmplxParams(output: unknown): Json | null {
  if (!isRecord(output)) {
    return null;
  }

  const candidate = output.smplx_params ?? output.smplx ?? output;
  return isJson(candidate) ? candidate : null;
}

export async function POST(request: Request): Promise<Response> {
  const jobId = new URL(request.url).searchParams.get('job_id');
  if (!jobId || !UUID_PATTERN.test(jobId)) {
    return Response.json({ error: 'Invalid fit job ID.' }, { status: 400 });
  }

  const body = await request.text();

  try {
    const event = verifyReplicateWebhook(body, request.headers);

    if (!event) {
      return Response.json({ error: 'Invalid webhook signature.' }, { status: 401 });
    }

    const serviceClient = createServiceClient();
    const { data: job, error: jobError } = await serviceClient
      .from('fit_jobs')
      .select('replicate_prediction_id, input_image_url')
      .eq('id', jobId)
      .maybeSingle();

    if (jobError || !job || job.replicate_prediction_id !== event.id) {
      return Response.json({ error: 'Prediction does not match fit job.' }, { status: 409 });
    }

    const isTerminalStatus = event.status === 'succeeded'
      || event.status === 'failed'
      || event.status === 'canceled';

    if (isTerminalStatus && job.input_image_url) {
      const wasPurged = await purgeBiometricAsset(job.input_image_url);

      if (!wasPurged) {
        return Response.json({ error: 'Unable to purge biometric source image.' }, { status: 500 });
      }
    }

    if (event.status === 'succeeded') {
      const { error: updateError } = await serviceClient
        .from('fit_jobs')
        .update({
          status: 'completed',
          input_image_url: null,
          smplx_params: extractSmplxParams(event.output),
          gltf_output_url: extractGltfOutputUrl(event.output),
          error_message: null,
        })
        .eq('id', jobId);

      if (updateError) {
        return Response.json({ error: 'Unable to save fit job output.' }, { status: 500 });
      }
    } else if (event.status === 'failed' || event.status === 'canceled') {
      const { error: updateError } = await serviceClient
        .from('fit_jobs')
        .update({
          status: 'failed',
          input_image_url: null,
          error_message: event.error ?? `Replicate prediction ${event.status}.`,
        })
        .eq('id', jobId);

      if (updateError) {
        return Response.json({ error: 'Unable to save fit job failure.' }, { status: 500 });
      }
    }

    return Response.json({ received: true, predictionId: event.id, status: event.status });
  } catch {
    return Response.json({ error: 'Webhook verification is unavailable.' }, { status: 503 });
  }
}
