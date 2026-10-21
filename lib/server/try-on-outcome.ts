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
  /** Where the drape's time went (server total, the GPU call, the GPU's own stages). */
  ms?: Record<string, number>;
}

/** A job's outcome log stays small: the latest tries only. */
const MAX_ATTEMPTS = 12;

function readRecord(value: Json | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

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
    | { kind: 'drape'; sku: string; size: string | null; drape: TryOnDrape; ms?: Record<string, number> }
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
      attempts.push({
        at,
        sku: update.sku,
        size: update.size,
        drape: update.drape,
        shown: null,
        ...(update.ms ? { ms: update.ms } : {}),
      });
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
      .update({
        try_on_outcome: { ...readRecord(data.try_on_outcome), attempts: attempts.slice(-MAX_ATTEMPTS) } as unknown as Json,
      })
      .eq('id', jobId)
      .eq('tenant_id', tenantId);
    if (writeError) {
      console.warn('[try-on-outcome] skipped', writeError.message);
    }
  } catch (caught) {
    console.warn('[try-on-outcome] skipped', caught instanceof Error ? caught.message : caught);
  }
}

/**
 * The body fit's GPU stage timings (durations only), kept on the job's outcome
 * log: `parametric_result`, which also carries them, is wiped by the TTL sweep.
 * Best-effort, like the attempts.
 */
export async function recordBodyStageTimings(jobId: string, tenantId: string, output: unknown): Promise<void> {
  const diagnostics = output && typeof output === 'object'
    ? (output as { fit_diagnostics?: { stage_timings_ms?: unknown } }).fit_diagnostics
    : undefined;
  const raw = diagnostics?.stage_timings_ms;
  if (!raw || typeof raw !== 'object') {
    return;
  }
  const timings: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      timings[key] = Math.round(value);
    }
  }
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from('fit_jobs')
      .select('try_on_outcome')
      .eq('id', jobId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    const { error } = await supabase
      .from('fit_jobs')
      .update({ try_on_outcome: { ...readRecord(data?.try_on_outcome), body_ms: timings } as unknown as Json })
      .eq('id', jobId)
      .eq('tenant_id', tenantId);
    if (error) {
      console.warn('[try-on-outcome] body timings skipped', error.message);
    }
  } catch (caught) {
    console.warn('[try-on-outcome] body timings skipped', caught instanceof Error ? caught.message : caught);
  }
}
