/**
 * Shopper A100 budget. Body + optional drape must finish inside this wall
 * clock **after Modal starts running** (`started_at`). Image pull /
 * `@modal.enter` is a separate budget so a cold replica is not canceled at the
 * exact moment `task=body` begins.
 */
export const SHOPPER_INFERENCE_DEADLINE_MS = 2 * 60 * 1000;
export const SESSION_GPU_SAFETY_TIMEOUT_MS = SHOPPER_INFERENCE_DEADLINE_MS;

/**
 * If capture warms the GPU but no job is submitted, sleep after this.
 * Height + two photos routinely take longer than three minutes; the widget
 * pings warmup every 45s while consent/photos are open, so this is idle
 * after the last ping. Must fit inside Vercel maxDuration (300s).
 */
export const SHOPPER_GPU_WARMUP_IDLE_MS = 4 * 60 * 1000;

/**
 * Max time a prediction may stay queued/starting after submit. Consent
 * warmup should already be pulling the baked image. Do not bill a shopper
 * for a 15-minute start.
 */
export const SHOPPER_GPU_SETUP_BUDGET_MS = 3 * 60 * 1000;

/** Widget wait: 3 minutes starting + 2 minutes of predict(). */
export const SHOPPER_AVATAR_WAIT_MS =
  SHOPPER_GPU_SETUP_BUDGET_MS + SHOPPER_INFERENCE_DEADLINE_MS;

/** Upper bound for a drape hold — never past the shopper deadline. */
export const GPU_HOLD_AFTER_BODY_MS = SHOPPER_INFERENCE_DEADLINE_MS;
export const GPU_HOLD_DURING_DRAPE_MS = SHOPPER_INFERENCE_DEADLINE_MS;

/** Skip Newton when the remaining budget cannot finish a drape. */
export const DRAPE_MIN_REMAINING_MS = 20 * 1000;

/**
 * Extra wait after scaling 0→1 so Modal `@enter` can finish before dispatch.
 * When min_containers is already 1, submit still waits a short settle so a
 * capture-warm GPU that is still loading weights is not dispatched empty.
 */
export const GPU_COLD_START_WAIT_MS = 70 * 1000;
export const GPU_WARM_SETTLE_WAIT_MS = 12 * 1000;

/** Concurrent Modal A100-80GB replicas. Operator env ASHRIUM_GPU_MAX_INSTANCES. */
export const DEFAULT_SHOPPER_GPU_MAX_INSTANCES = 3;
export const SHOPPER_GPU_MAX_INSTANCES_CEILING = 8;

export const FITTING_ROOM_AT_CAPACITY_MESSAGE =
  'The fitting room is at capacity. Please try again in a minute.';

export function readShopperGpuMaxInstances(raw = process.env.ASHRIUM_GPU_MAX_INSTANCES): number {
  const parsed = Number.parseInt(raw?.trim() ?? '', 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SHOPPER_GPU_MAX_INSTANCES;
  }

  return Math.min(
    SHOPPER_GPU_MAX_INSTANCES_CEILING,
    Math.max(1, Math.trunc(parsed)),
  );
}

export const MODAL_A100_USD_PER_SEC = 0.000694;

export const SHOPPER_GPU_TIMEOUT_MESSAGE =
  'Sorry — the fitting GPU stopped so you are not billed further. Please try again and keep Try On open until the avatar appears.';

export type SessionGpuAction = 'warm' | 'sleep' | 'status';

export function shopperGpuActiveLookbackMs(): number {
  return SHOPPER_AVATAR_WAIT_MS;
}

export function shopperInferenceDeadlineMs(
  createdAt: string,
  inferenceStartedAt?: string | null,
  predictionStatus?: string | null,
): number {
  const status = predictionStatus?.trim().toLowerCase() ?? '';
  const setupOnly = status === 'starting' || status === 'queued';
  const started = !setupOnly && inferenceStartedAt ? Date.parse(inferenceStartedAt) : Number.NaN;
  if (Number.isFinite(started)) {
    return started + SHOPPER_INFERENCE_DEADLINE_MS;
  }

  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) {
    return Date.now() + SHOPPER_GPU_SETUP_BUDGET_MS;
  }

  return created + SHOPPER_GPU_SETUP_BUDGET_MS;
}

export function isShopperInferenceOverdue(
  createdAt: string,
  now = Date.now(),
  inferenceStartedAt?: string | null,
  predictionStatus?: string | null,
): boolean {
  return now >= shopperInferenceDeadlineMs(createdAt, inferenceStartedAt, predictionStatus);
}

export function gpuHoldMsUntilDeadline(
  createdAt: string,
  now = Date.now(),
  inferenceStartedAt?: string | null,
  predictionStatus?: string | null,
): number {
  return Math.max(0, shopperInferenceDeadlineMs(createdAt, inferenceStartedAt, predictionStatus) - now);
}

export function sessionGpuShouldSleep(input: {
  activeBodyJobCount: number;
  activeDrapeHoldCount: number;
  warmupLeaseCount?: number;
}): boolean {
  return (
    input.activeBodyJobCount <= 0
    && input.activeDrapeHoldCount <= 0
    && (input.warmupLeaseCount ?? 0) <= 0
  );
}

export function shopperGpuOccupancy(input: {
  activeBodyJobCount: number;
  warmupLeaseCount: number;
}): number {
  return Math.max(0, input.activeBodyJobCount) + Math.max(0, input.warmupLeaseCount);
}
