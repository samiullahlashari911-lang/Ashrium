/** Idle billed A100 session: Warm sets min_instances=1; Sleep and this timer set 0. */
export const SESSION_GPU_SAFETY_TIMEOUT_MS = 45 * 60 * 1000;

/** Replicate Nvidia A100 80GB list price used in operator copy. */
export const REPLICATE_A100_USD_PER_SEC = 0.0014;

export type SessionGpuAction = 'warm' | 'sleep' | 'status';
