/**
 * Shopper A100 budget. Body + optional drape must finish inside this wall
 * clock **after Replicate starts running** (`started_at`). Cog `setup()` /
 * queue time is a separate budget so a cold replica is not canceled at the
 * exact moment `task=body` begins.
 */
export const SHOPPER_INFERENCE_DEADLINE_MS = 2 * 60 * 1000;
export const SESSION_GPU_SAFETY_TIMEOUT_MS = SHOPPER_INFERENCE_DEADLINE_MS;

/** If capture starts the GPU but no job is submitted, sleep after this. */
export const SHOPPER_GPU_WARMUP_IDLE_MS = 3 * 60 * 1000;

/**
 * Max time a prediction may stay queued/starting before we abort. Observed
 * A100 Cog setup is ~120s; this matches capture warmup idle so a replica that
 * never comes up cannot bill forever.
 */
export const SHOPPER_GPU_SETUP_BUDGET_MS = SHOPPER_GPU_WARMUP_IDLE_MS;

/** Widget / occupancy lookback covering setup plus the inference wall. */
export const SHOPPER_AVATAR_WAIT_MS =
  SHOPPER_GPU_SETUP_BUDGET_MS + SHOPPER_INFERENCE_DEADLINE_MS;

/** Upper bound for a drape hold — never past the shopper deadline. */
export const GPU_HOLD_AFTER_BODY_MS = SHOPPER_INFERENCE_DEADLINE_MS;
export const GPU_HOLD_DURING_DRAPE_MS = SHOPPER_INFERENCE_DEADLINE_MS;

/** Skip Newton when the remaining budget cannot finish a drape. */
export const DRAPE_MIN_REMAINING_MS = 20 * 1000;

/**
 * Extra wait after scaling 0→1 so Cog `setup()` can finish before dispatch.
 * When min_instances is already 1, submit still waits a short settle so a
 * capture-warm GPU that is still pulling the image is not dispatched empty.
 */
export const GPU_COLD_START_WAIT_MS = 70 * 1000;
export const GPU_WARM_SETTLE_WAIT_MS = 12 * 1000;

/** Concurrent gpu-a100-large replicas. Operator env ASHRIUM_GPU_MAX_INSTANCES. */
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

/** Replicate Nvidia A100 80GB list price used in operator copy. */
export const REPLICATE_A100_USD_PER_SEC = 0.0014;

export const SHOPPER_GPU_TIMEOUT_MESSAGE =
  'Sorry — we stopped the fitting GPU after 2 minutes so you are not billed further. Please try again.';

export type SessionGpuAction = 'warm' | 'sleep' | 'status';

export function shopperGpuActiveLookbackMs(): number {
  return SHOPPER_AVATAR_WAIT_MS;
}

export function shopperInferenceDeadlineMs(
  createdAt: string,
  inferenceStartedAt?: string | null,
): number {
  const started = inferenceStartedAt ? Date.parse(inferenceStartedAt) : Number.NaN;
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
): boolean {
  return now >= shopperInferenceDeadlineMs(createdAt, inferenceStartedAt);
}

export function gpuHoldMsUntilDeadline(
  createdAt: string,
  now = Date.now(),
  inferenceStartedAt?: string | null,
): number {
  return Math.max(0, shopperInferenceDeadlineMs(createdAt, inferenceStartedAt) - now);
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
