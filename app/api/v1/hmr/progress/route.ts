import { verifyGpuCallback } from '@/lib/server/gpu-callback-auth';
import { isFitJobId } from '@/lib/server/fit-request';
import { createServiceClient } from '@/lib/supabase/service';
import { GPU_REPORTED_STAGES, isAvatarStageKey } from '@/lib/widget/avatar-stages';

export const runtime = 'nodejs';

const TENANT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Modal → app stage callback (gpu/progress.py). HMAC-signed with
 * ASHRIUM_GPU_HMAC; scoped by job id AND tenant id; only moves a job that is
 * still running. The row update fans out on Realtime `fit_job:{id}`.
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const authorized = verifyGpuCallback({
    rawBody,
    timestamp: request.headers.get('x-ashrium-timestamp'),
    signature: request.headers.get('x-ashrium-signature'),
  });
  if (!authorized) {
    return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  }

  if (typeof payload !== 'object' || payload === null) {
    return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  }

  const record = payload as Record<string, unknown>;
  const jobId = record.job_id;
  const tenantId = record.tenant_id;
  const stage = record.stage;
  if (
    !isFitJobId(jobId)
    || typeof tenantId !== 'string'
    || !TENANT_ID_PATTERN.test(tenantId)
    || !isAvatarStageKey(stage)
    || !GPU_REPORTED_STAGES.has(stage)
  ) {
    return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const supabase = createServiceClient();
  const { error } = await supabase
    .from('fit_jobs')
    .update({ progress_stage: stage, progress_at: now })
    .eq('id', jobId)
    .eq('tenant_id', tenantId)
    .in('status', ['pending', 'processing']);

  if (error) {
    return Response.json({ code: 'PROGRESS_WRITE_FAILED' }, { status: 500 });
  }

  if (stage === 'silhouettes') {
    // First GPU stage = inference really started (queue / cold start is over).
    await supabase
      .from('fit_jobs')
      .update({ gpu_started_at: now })
      .eq('id', jobId)
      .eq('tenant_id', tenantId)
      .is('gpu_started_at', null);
  }

  return Response.json({ ok: true });
}
