import {
  applyHmrPredictionToFitJob,
  HmrJobApplyError,
} from '@/lib/server/apply-hmr-prediction';
import { verifyReplicateWebhook } from '@/lib/server/replicate-webhook';
import { createServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

    try {
      await applyHmrPredictionToFitJob(jobId, event, job);
    } catch (error) {
      const message = error instanceof HmrJobApplyError
        ? error.message
        : 'Unable to apply Replicate prediction.';
      return Response.json({ error: message }, { status: 500 });
    }

    return Response.json({ received: true, predictionId: event.id, status: event.status });
  } catch {
    return Response.json({ error: 'Webhook verification is unavailable.' }, { status: 503 });
  }
}
