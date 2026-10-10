import { createServiceClient } from '@/lib/supabase/service';
import type { Json } from '@/types/database';
import type { FitDrapeUnavailableReason } from '@/types/graphics';

/** What the drape step returned for one try: a drape, or why there is none. */
export type TryOnDrape = 'newton' | 'cache' | FitDrapeUnavailableReason | 'unavailable' | 'error';

export interface TryOnAttempt {
  at: string;
  sku: string;
  size: string | null;
  drape: TryOnDrape | null;
  /** Reported by the shopper's device: the garment was drawn on their photo. */
  shown: boolean | null;
}

/** A job's outcome log stays small: the latest tries only. */
const MAX_ATTEMPTS = 12;

function readAttempts(value: Json | null | undefined): TryOnAttempt[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  const attempts = (value as { attempts?: unknown }).attempts;
  return Array.isArray(attempts) ? (attempts as TryOnAttempt[]) : [];
}

/**
 * Best-effort: records what a try-on showed (labels only — no photos, no body
 * data), so "there were no clothes on me" can be answered from the job row.
 * The drape result opens an attempt; the device's drawn signal completes the
 * latest attempt for that SKU and size. Never fails the shopper's request.
 */
export async function recordTryOnOutcome(
  jobId: string,
  tenantId: string,
  update:
    | { kind: 'drape'; sku: string; size: string | null; drape: TryOnDrape }
    | { kind: 'shown'; sku: string; size: string | null; shown: boolean },
): Promise<void> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('fit_jobs')
      .select('try_on_outcome')
      .eq('id', jobId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error || !data) {
      return;
    }

    const attempts = readAttempts(data.try_on_outcome);
    const at = new Date().toISOString();
    if (update.kind === 'drape') {
      attempts.push({ at, sku: update.sku, size: update.size, drape: update.drape, shown: null });
    } else {
      const open = [...attempts]
        .reverse()
        .find((attempt) => attempt.sku === update.sku && attempt.size === update.size && attempt.shown === null);
      if (open) {
        open.shown = update.shown;
      } else {
        attempts.push({ at, sku: update.sku, size: update.size, drape: null, shown: update.shown });
      }
    }

    const { error: writeError } = await supabase
      .from('fit_jobs')
      .update({ try_on_outcome: { attempts: attempts.slice(-MAX_ATTEMPTS) } as unknown as Json })
      .eq('id', jobId)
      .eq('tenant_id', tenantId);
    if (writeError) {
      console.warn('[try-on-outcome] skipped', writeError.message);
    }
  } catch (caught) {
    console.warn('[try-on-outcome] skipped', caught instanceof Error ? caught.message : caught);
  }
}
