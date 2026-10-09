import { createServiceClient } from '@/lib/supabase/service';

/**
 * Per-store ceiling on Try Ons in a rolling 24 hours. Real stores stay far
 * below it; it bounds the GPU bill if embed tokens are farmed from many IPs.
 * Raise it per deployment with ASHRIUM_DAILY_TRYON_CAP.
 */
export const DEFAULT_DAILY_TRYON_CAP = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const DAILY_TRYON_CAP_MESSAGE =
  'Try On is very busy at this store right now. Please try again later.';

export function dailyTryOnCap(raw: string | undefined = process.env.ASHRIUM_DAILY_TRYON_CAP): number {
  const parsed = Number.parseInt(raw?.trim() ?? '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_TRYON_CAP;
}

/** True when this tenant has used its rolling-24h Try On allowance. */
export async function dailyTryOnCapReached(tenantId: string): Promise<boolean> {
  const cap = dailyTryOnCap();
  const supabase = createServiceClient();
  const { count, error } = await supabase
    .from('fit_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .gte('created_at', new Date(Date.now() - DAY_MS).toISOString());

  if (error || count === null) {
    // Never block shoppers on a counting failure; the per-IP and capacity
    // limits still apply.
    return false;
  }

  if (count === Math.floor(cap * 0.8)) {
    console.warn(`[daily-tryon-cap] tenant ${tenantId} reached 80% of ${cap} Try Ons in 24h`);
  }

  if (count >= cap) {
    await supabase.from('audit_logs').insert({
      tenant_id: tenantId,
      event_type: 'RATE_LIMIT_EXCEEDED',
      payload: { route: 'daily-tryon-cap', cap, count },
    });
    return true;
  }

  return false;
}
