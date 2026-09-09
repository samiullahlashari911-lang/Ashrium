import { fetchReplicatePrediction } from '@/lib/ml/replicate';
import { isShopperInferenceOverdue } from '@/lib/ml/session-gpu';
import { abortFitJobIfOverdue } from '@/lib/server/abort-shopper-gpu';
import { applyHmrPredictionToFitJob } from '@/lib/server/apply-hmr-prediction';
import { consumeRateLimit } from '@/lib/server/durable-rate-limit';
import { RATE_LIMITS, RATE_LIMIT_WINDOW_MS } from '@/lib/server/rate-limit';
import { isFitJobId } from '@/lib/server/fit-request';
import { resolveRequestTenantId } from '@/lib/server/request-tenant';
import { createServiceClient } from '@/lib/supabase/service';

const PUBLIC_JOB_COLUMNS = 'id, status, parametric_result, error_message, created_at, updated_at';

function publicJobPayload(job: {
  id: string;
  status: string;
  parametric_result: unknown;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}): {
  id: string;
  status: string;
  parametric_result: unknown;
  error_message: string | null;
  created_at: string;
  updated_at: string;
} {
  return {
    id: job.id,
    status: job.status,
    parametric_result: job.parametric_result,
    error_message: job.error_message,
    created_at: job.created_at,
    updated_at: job.updated_at,
  };
}

export async function GET(request: Request): Promise<Response> {
  const jobId = new URL(request.url).searchParams.get('job_id');

  if (!jobId || !isFitJobId(jobId)) {
    return Response.json({ code: 'INVALID_JOB_ID' }, { status: 400 });
  }

  let tenantId: string;
  try {
    tenantId = await resolveRequestTenantId(request);
  } catch {
    return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const rateLimit = await consumeRateLimit(
    `hmr-status:${tenantId}`,
    RATE_LIMITS.hmrStatus,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!rateLimit.allowed) {
    return Response.json({ code: 'RATE_LIMIT_EXCEEDED' }, { status: 429 });
  }

  const supabase = createServiceClient();
  const { data: job, error } = await supabase
    .from('fit_jobs')
    .select(
      `${PUBLIC_JOB_COLUMNS}, replicate_prediction_id, front_image_path, side_image_path, weight_kg`,
    )
    .eq('id', jobId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) {
    return Response.json({ code: 'JOB_LOOKUP_FAILED' }, { status: 500 });
  }

  if (!job) {
    return Response.json({ code: 'JOB_NOT_FOUND' }, { status: 404 });
  }

  if (
    (job.status === 'processing' || job.status === 'pending')
    && typeof job.created_at === 'string'
    && isShopperInferenceOverdue(job.created_at)
  ) {
    const aborted = await abortFitJobIfOverdue(jobId);
    if (aborted) {
      const { data: timedOut } = await supabase
        .from('fit_jobs')
        .select(PUBLIC_JOB_COLUMNS)
        .eq('id', jobId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (timedOut) {
        return Response.json({ job: publicJobPayload(timedOut) });
      }
    }
  }

  const predictionId = job.replicate_prediction_id;
  const shouldReconcile =
    (job.status === 'processing' || job.status === 'pending')
    && typeof predictionId === 'string'
    && predictionId.length > 0;

  if (shouldReconcile && predictionId) {
    try {
      const prediction = await fetchReplicatePrediction(predictionId);
      await applyHmrPredictionToFitJob(jobId, prediction, job);
    } catch {
      // Webhook may still land. Return the row we already have.
    }

    const { data: refreshed, error: refreshError } = await supabase
      .from('fit_jobs')
      .select(PUBLIC_JOB_COLUMNS)
      .eq('id', jobId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (!refreshError && refreshed) {
      return Response.json({ job: publicJobPayload(refreshed) });
    }
  }

  return Response.json({ job: publicJobPayload(job) });
}
