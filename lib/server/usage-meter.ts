import { createServiceClient } from '@/lib/supabase/service';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface TenantUsageDecision {
  fitSessionsCount: number;
  monthlyQuota: number;
  overageAllowed: boolean;
  planTier: string;
  usesByok: boolean;
}

export class TenantQuotaExceededError extends Error {
  readonly code = 'QUOTA_EXCEEDED';

  constructor() {
    super('The tenant has reached its monthly fit-session quota.');
    this.name = 'TenantQuotaExceededError';
  }
}

function assertTenantId(tenantId: string): void {
  if (!UUID_PATTERN.test(tenantId)) {
    throw new Error('A valid tenant ID is required for usage metering.');
  }
}

export async function verifyAndRecordTenantUsage(
  tenantId: string,
): Promise<TenantUsageDecision> {
  assertTenantId(tenantId);

  const supabase = createServiceClient();
  const { data: merchant, error: merchantError } = await supabase
    .from('merchants')
    .select('plan_tier, monthly_quota, overage_allowed')
    .eq('id', tenantId)
    .maybeSingle();

  if (merchantError) {
    throw new Error(`Unable to load tenant plan: ${merchantError.message}`);
  }

  if (!merchant) {
    throw new Error('Tenant was not found.');
  }

  const { data: integration, error: integrationError } = await supabase
    .from('tenant_integrations')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('provider', 'replicate')
    .eq('is_active', true)
    .not('replicate_api_key_ciphertext', 'is', null)
    .maybeSingle();

  if (integrationError) {
    throw new Error(`Unable to verify tenant integration: ${integrationError.message}`);
  }

  const usesByok = merchant.plan_tier === 'enterprise' && integration !== null;
  if (usesByok) {
    return {
      fitSessionsCount: 0,
      monthlyQuota: merchant.monthly_quota,
      overageAllowed: merchant.overage_allowed,
      planTier: merchant.plan_tier,
      usesByok: true,
    };
  }

  const { data: meterRows, error: meterError } = await supabase.rpc(
    'increment_fit_session_counter',
    { p_tenant_id: tenantId },
  );

  if (meterError) {
    throw new Error(`Unable to record tenant usage: ${meterError.message}`);
  }

  const meter = meterRows[0];
  if (!meter) {
    throw new Error('Usage meter did not return a decision.');
  }

  if (meter.quota_exceeded) {
    throw new TenantQuotaExceededError();
  }

  return {
    fitSessionsCount: meter.fit_sessions_count,
    monthlyQuota: meter.monthly_quota,
    overageAllowed: meter.overage_allowed,
    planTier: meter.plan_tier,
    usesByok: false,
  };
}
