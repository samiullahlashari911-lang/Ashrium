interface RateLimitWindow {
  timestamps: number[];
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export interface RateLimitWindowInput {
  timestamps: readonly number[];
  now: number;
  limit: number;
  windowMs: number;
}

export const RATE_LIMIT_WINDOW_MS = 60 * 1000;

export const RATE_LIMITS = {
  widgetToken: 30,
  widgetTokenIp: 60,
  uploadUrl: 20,
  hmrDispatch: 20,
  hmrWarmup: 12,
  hmrStatus: 60,
  fitRecommend: 60,
  fitResolve: 20,
  catalogSync: 10,
} as const;

const rateLimitWindows = new Map<string, RateLimitWindow>();

export function evaluateRateLimitWindow(input: RateLimitWindowInput): {
  timestamps: number[];
  result: RateLimitResult;
} {
  if (
    !Number.isSafeInteger(input.limit)
    || input.limit < 1
    || !Number.isSafeInteger(input.windowMs)
    || input.windowMs < 1
  ) {
    throw new Error('Rate limit identifier, limit, and window must be valid.');
  }

  const windowStart = input.now - input.windowMs;
  const timestamps = input.timestamps.filter((timestamp) => timestamp > windowStart);
  const allowed = timestamps.length < input.limit;

  if (allowed) {
    timestamps.push(input.now);
  }

  const oldestTimestamp = timestamps[0] ?? input.now;
  return {
    timestamps,
    result: {
      allowed,
      limit: input.limit,
      remaining: Math.max(input.limit - timestamps.length, 0),
      resetAt: oldestTimestamp + input.windowMs,
    },
  };
}

/** In-memory fallback used when the durable RPC is unavailable, and in unit tests. */
export function checkRateLimit(
  identifier: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  if (!identifier) {
    throw new Error('Rate limit identifier, limit, and window must be valid.');
  }

  const evaluated = evaluateRateLimitWindow({
    timestamps: rateLimitWindows.get(identifier)?.timestamps ?? [],
    now: Date.now(),
    limit,
    windowMs,
  });

  if (evaluated.timestamps.length === 0) {
    rateLimitWindows.delete(identifier);
  } else {
    rateLimitWindows.set(identifier, { timestamps: evaluated.timestamps });
  }

  return evaluated.result;
}

export function resetRateLimitWindowsForTests(): void {
  rateLimitWindows.clear();
}
