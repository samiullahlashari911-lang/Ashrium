/** Idle billed A100 session: Warm sets min_instances=1; Sleep and this timer set 0. */
export const SESSION_GPU_SAFETY_TIMEOUT_MS = 45 * 60 * 1000;

/**
 * After task=body succeeds, keep the Deployment warm so task=drape does not
 * pay a cold start. Client resolve starts as soon as the avatar lands.
 */
export const GPU_HOLD_AFTER_BODY_MS = 10 * 60 * 1000;

/** Cover an in-flight Newton prediction on the same warm A100. */
export const GPU_HOLD_DURING_DRAPE_MS = 20 * 60 * 1000;

/** Replicate Nvidia A100 80GB list price used in operator copy. */
export const REPLICATE_A100_USD_PER_SEC = 0.0014;

export type SessionGpuAction = 'warm' | 'sleep' | 'status';

export function sessionGpuShouldSleep(input: {
  activeBodyJobCount: number;
  activeDrapeHoldCount: number;
}): boolean {
  return input.activeBodyJobCount <= 0 && input.activeDrapeHoldCount <= 0;
}
