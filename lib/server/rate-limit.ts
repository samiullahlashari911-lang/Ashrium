interface RateLimitWindow {
  timestamps: number[];
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

const rateLimitWindows = new Map<string, RateLimitWindow>();

export function checkRateLimit(
  identifier: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  if (!identifier || !Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new Error('Rate limit identifier, limit, and window must be valid.');
  }

  const now = Date.now();
  const windowStart = now - windowMs;
  const existingWindow = rateLimitWindows.get(identifier);
  const timestamps = existingWindow?.timestamps.filter((timestamp) => timestamp > windowStart) ?? [];
  const allowed = timestamps.length < limit;

  if (allowed) {
    timestamps.push(now);
  }

  if (timestamps.length === 0) {
    rateLimitWindows.delete(identifier);
  } else {
    rateLimitWindows.set(identifier, { timestamps });
  }

  const oldestTimestamp = timestamps[0] ?? now;
  return {
    allowed,
    limit,
    remaining: Math.max(limit - timestamps.length, 0),
    resetAt: oldestTimestamp + windowMs,
  };
}
