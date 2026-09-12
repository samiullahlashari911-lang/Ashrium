/**
 * Shopper A100 budget. Body + optional drape must finish inside this wall
 * clock. After it lapses we cancel Replicate predictions, fail the job, and
 * PATCH min_instances=0 so idle GPU time cannot run past two minutes.
 */
export const SHOPPER_INFERENCE_DEADLINE_MS = 2 * 60 * 1000;
export const SESSION_GPU_SAFETY_TIMEOUT_MS = SHOPPER_INFERENCE_DEADLINE_MS;

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

/** If capture starts the GPU but no job is submitted, sleep after this. */
export const SHOPPER_GPU_WARMUP_IDLE_MS = 3 * 60 * 1000;

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

export function shopperInferenceDeadlineMs(createdAt: string): number {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) {
    return Date.now() + SHOPPER_INFERENCE_DEADLINE_MS;
  }

  return created + SHOPPER_INFERENCE_DEADLINE_MS;
}

export function isShopperInferenceOverdue(createdAt: string, now = Date.now()): boolean {
  return now >= shopperInferenceDeadlineMs(createdAt);
}

export function gpuHoldMsUntilDeadline(createdAt: string, now = Date.now()): number {
  return Math.max(0, shopperInferenceDeadlineMs(createdAt) - now);
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
