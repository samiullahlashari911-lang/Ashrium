import { parseMhrParametricVector } from '@/lib/ml/replicate';
import { purgeBiometricJobImages } from '@/lib/server/biometrics-wipe';
import { verifyReplicateWebhook } from '@/lib/server/replicate-webhook';
import { createServiceClient } from '@/lib/supabase/service';
import type { Json } from '@/types/database';
import type { MhrParametricVector } from '@/types/hmr';

export const runtime = 'nodejs';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PARAMETRIC_RESULT_TTL_MS = 15 * 60 * 1000;

function toJson(value: MhrParametricVector): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
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
      .select(
        'replicate_prediction_id, front_image_path, side_image_path, created_at, weight_kg',
      )
      .eq('id', jobId)
      .maybeSingle();

    if (jobError || !job || job.replicate_prediction_id !== event.id) {
      return Response.json({ error: 'Prediction does not match fit job.' }, { status: 409 });
    }

    const isTerminalStatus =
      event.status === 'succeeded' || event.status === 'failed' || event.status === 'canceled';

    if (isTerminalStatus) {
      const wasPurged = await purgeBiometricJobImages(
        job.front_image_path,
        job.side_image_path,
      );

      if (!wasPurged) {
        return Response.json({ error: 'Unable to purge biometric source images.' }, { status: 500 });
      }
    }

    if (event.status === 'succeeded') {
      try {
        const parametricResult = parseMhrParametricVector(
          event.output,
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
          return Response.json({ error: 'Unable to save fit job output.' }, { status: 500 });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'MHR Cog output was invalid.';
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
          return Response.json({ error: 'Unable to save fit job failure.' }, { status: 500 });
        }
      }
    } else if (event.status === 'failed' || event.status === 'canceled') {
      const { error: updateError } = await serviceClient
        .from('fit_jobs')
        .update({
          status: 'failed',
          front_image_path: null,
          side_image_path: null,
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
