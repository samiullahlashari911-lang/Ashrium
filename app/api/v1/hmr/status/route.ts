import { createClient } from '@/lib/supabase/server';
import { requireCurrentTenantId } from '@/lib/supabase/tenant';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request): Promise<Response> {
  const jobId = new URL(request.url).searchParams.get('job_id');

  if (!jobId || !UUID_PATTERN.test(jobId)) {
    return Response.json({ code: 'INVALID_JOB_ID' }, { status: 400 });
  }

  let tenantId: string;
  try {
    tenantId = await requireCurrentTenantId();
  } catch {
    return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const supabase = await createClient();
  const { data: job, error } = await supabase
    .from('fit_jobs')
    .select('id, status, smplx_params, gltf_output_url, error_message, created_at, updated_at')
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
