import { consumeRateLimit } from '@/lib/server/durable-rate-limit';
import { RATE_LIMITS, RATE_LIMIT_WINDOW_MS } from '@/lib/server/rate-limit';
import { isFitJobId } from '@/lib/server/fit-request';
import { resolveRequestTenantId } from '@/lib/server/request-tenant';
import { createServiceClient } from '@/lib/supabase/service';

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
    .select('id, status, parametric_result, error_message, created_at, updated_at')
    .eq('id', jobId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) {
    return Response.json({ code: 'JOB_LOOKUP_FAILED' }, { status: 500 });
  }

  if (!job) {
    return Response.json({ code: 'JOB_NOT_FOUND' }, { status: 404 });
  }

  return Response.json({ job });
}
