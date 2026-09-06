import {
  checkRateLimit,
  RATE_LIMIT_WINDOW_MS,
  type RateLimitResult,
} from '@/lib/server/rate-limit';
import { createServiceClient } from '@/lib/supabase/service';

function isConsumeRow(
  value: unknown,
): value is { allowed: boolean; remaining: number; reset_at: string } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const row = value as Record<string, unknown>;
  return (
    typeof row.allowed === 'boolean'
    && typeof row.remaining === 'number'
    && Number.isFinite(row.remaining)
    && typeof row.reset_at === 'string'
    && row.reset_at.length > 0
  );
}

/**
 * Durable sliding-window limiter via Postgres. Falls back to the in-memory
 * window if the RPC is unreachable so a migration gap does not take the
 * storefront down — that fallback is per-instance only.
 */
export async function consumeRateLimit(
  identifier: string,
  limit: number,
  windowMs: number = RATE_LIMIT_WINDOW_MS,
): Promise<RateLimitResult> {
  if (!identifier || !Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new Error('Rate limit identifier, limit, and window must be valid.');
  }

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc('consume_rate_limit', {
      p_identifier: identifier,
      p_limit: limit,
      p_window_ms: windowMs,
    });

    const row = Array.isArray(data) ? data[0] : data;
    if (!error && isConsumeRow(row)) {
      const resetAt = Date.parse(row.reset_at);
      return {
        allowed: row.allowed,
        limit,
        remaining: Math.max(Math.floor(row.remaining), 0),
        resetAt: Number.isFinite(resetAt) ? resetAt : Date.now() + windowMs,
      };
    }
  } catch {
    // Fall through to the in-memory window.
  }

  return checkRateLimit(identifier, limit, windowMs);
}

export async function rateLimitedJsonResponse(
  identifier: string,
  limit: number,
  windowMs: number = RATE_LIMIT_WINDOW_MS,
): Promise<Response | null> {
  const result = await consumeRateLimit(identifier, limit, windowMs);
  if (result.allowed) {
    return null;
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
  return Response.json(
    { code: 'RATE_LIMIT_EXCEEDED' },
    {
      status: 429,
      headers: {
        'Cache-Control': 'no-store',
        'Retry-After': String(retryAfterSeconds),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': '0',
      },
    },
  );
}
