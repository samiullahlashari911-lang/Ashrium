import { calculateReturnRateAnalytics } from '@/lib/analytics/return-rates';
import { createServiceClient } from '@/lib/supabase/service';
import { requireCurrentTenantId } from '@/lib/supabase/tenant';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  let tenantId: string;

  try {
    tenantId = await requireCurrentTenantId();
  } catch {
    return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  const { data: telemetry, error } = await serviceClient
    .from('store_telemetry')
    .select('*')
    .eq('tenant_id', tenantId);

  if (error) {
    return Response.json({ code: 'TELEMETRY_QUERY_FAILED' }, { status: 500 });
  }

  const analytics = calculateReturnRateAnalytics(telemetry ?? []);

  return Response.json({
    baseline_orders: analytics.baselineOrders,
    baseline_return_rate: analytics.baselineReturnRate,
    baseline_size_return_rate: analytics.baselineSizeReturnRate,
    guarantee_achieved: analytics.guaranteeAchieved,
    size_related_reduction_percentage: analytics.sizeRelatedReductionPercentage,
    total_orders: analytics.totalOrders,
    vfr_orders: analytics.vfrOrders,
    vfr_return_rate: analytics.vfrReturnRate,
    vfr_session_count: analytics.totalVfrSessions,
    vfr_size_return_rate: analytics.vfrSizeReturnRate,
  });
}
