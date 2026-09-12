import { patchReplicateDeployment, setReplicateSessionGpu } from '@/lib/ml/replicate';
import {
  FITTING_ROOM_AT_CAPACITY_MESSAGE,
  GPU_COLD_START_WAIT_MS,
  GPU_WARM_SETTLE_WAIT_MS,
  SHOPPER_GPU_WARMUP_IDLE_MS,
  SHOPPER_INFERENCE_DEADLINE_MS,
  readShopperGpuMaxInstances,
  sessionGpuShouldSleep,
  shopperGpuOccupancy,
} from '@/lib/ml/session-gpu';
import { createServiceClient } from '@/lib/supabase/service';

export class FittingRoomAtCapacityError extends Error {
  readonly code = 'FITTING_ROOM_AT_CAPACITY' as const;

  constructor(message = FITTING_ROOM_AT_CAPACITY_MESSAGE) {
    super(message);
    this.name = 'FittingRoomAtCapacityError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function countActiveBodyJobs(): Promise<number> {
  const supabase = createServiceClient();
  const cutoff = new Date(Date.now() - SHOPPER_INFERENCE_DEADLINE_MS).toISOString();
  const { count, error } = await supabase
    .from('fit_jobs')
    .select('id', { count: 'exact', head: true })
    .in('status', ['pending', 'processing'])
    .gt('created_at', cutoff);

  if (error) {
    return 0;
  }

  return count ?? 0;
}

async function countDrapeHolds(): Promise<number> {
  const supabase = createServiceClient();
  const { count, error } = await supabase
    .from('fit_jobs')
    .select('id', { count: 'exact', head: true })
    .gt('gpu_hold_until', new Date().toISOString());

  if (error) {
    return 0;
  }

  return count ?? 0;
}

async function countWarmupLeases(): Promise<number> {
  const supabase = createServiceClient();
  const { count, error } = await supabase
    .from('shopper_gpu_sessions')
    .select('id', { count: 'exact', head: true })
    .gt('expires_at', new Date().toISOString());

  if (error) {
    return 0;
  }

  return count ?? 0;
}

export async function readShopperGpuOccupancy(): Promise<{
  activeBodyJobCount: number;
  warmupLeaseCount: number;
  occupancy: number;
  cap: number;
}> {
  const [activeBodyJobCount, warmupLeaseCount] = await Promise.all([
    countActiveBodyJobs(),
    countWarmupLeases(),
  ]);
  const cap = readShopperGpuMaxInstances();
  return {
    activeBodyJobCount,
    warmupLeaseCount,
    occupancy: shopperGpuOccupancy({ activeBodyJobCount, warmupLeaseCount }),
    cap,
  };
}

async function scaleShopperDeployment(occupancy: number): Promise<{
  minInstancesUpdated: boolean;
}> {
  const cap = readShopperGpuMaxInstances();
  const n = Math.min(cap, Math.max(0, occupancy));
  const patched = await patchReplicateDeployment({
    minInstances: n,
    maxInstances: cap,
    pinHardware: true,
  });
  return { minInstancesUpdated: patched.minInstancesUpdated };
}

function isLiveLease(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) {
    return false;
  }

  const expires = Date.parse(expiresAt);
  return Number.isFinite(expires) && expires > Date.now();
}

/**
 * Capture path. Upserts a warmup lease, scales replicas to occupancy,
 * and 409s only when the room is already at the replica cap.
 */
export async function claimShopperGpuSession(
  tenantId: string,
  sessionKey: string,
): Promise<{ minInstancesUpdated: boolean; created: boolean }> {
  const key = sessionKey.trim();
  if (key.length < 8 || key.length > 80) {
    throw new Error('Invalid GPU session key.');
  }

  const supabase = createServiceClient();
  const expiresAt = new Date(Date.now() + SHOPPER_GPU_WARMUP_IDLE_MS).toISOString();
  const { data: existing } = await supabase
    .from('shopper_gpu_sessions')
    .select('id, expires_at')
    .eq('tenant_id', tenantId)
    .eq('session_key', key)
    .maybeSingle();

  const refreshingLive = isLiveLease(existing?.expires_at);
  if (!refreshingLive) {
    const before = await readShopperGpuOccupancy();
    if (before.occupancy >= before.cap) {
      throw new FittingRoomAtCapacityError();
    }
  }

  const { error } = await supabase.from('shopper_gpu_sessions').upsert(
    {
      tenant_id: tenantId,
      session_key: key,
      expires_at: expiresAt,
    },
    { onConflict: 'tenant_id,session_key' },
  );

  if (error) {
    throw new Error(error.message);
  }

  const scaled = await scaleShopperDeployment((await readShopperGpuOccupancy()).occupancy);
  return {
    minInstancesUpdated: scaled.minInstancesUpdated || !refreshingLive,
    created: !refreshingLive,
  };
}

export async function convertWarmupLeaseToJob(
  tenantId: string,
  sessionKey?: string,
): Promise<boolean> {
  const supabase = createServiceClient();
  const now = new Date().toISOString();
  if (sessionKey && sessionKey.trim().length > 0) {
    const { data } = await supabase
      .from('shopper_gpu_sessions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('session_key', sessionKey.trim())
      .gt('expires_at', now)
      .maybeSingle();

    if (!data) {
      return false;
    }

    await supabase.from('shopper_gpu_sessions').delete().eq('id', data.id);
    return true;
  }

  const { data } = await supabase
    .from('shopper_gpu_sessions')
    .select('id')
    .eq('tenant_id', tenantId)
    .gt('expires_at', now)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data) {
    return false;
  }

  await supabase.from('shopper_gpu_sessions').delete().eq('id', data.id);
  return true;
}

export async function scaleShopperGpuToOccupancy(): Promise<{
  occupancy: number;
  cap: number;
  minInstancesUpdated: boolean;
}> {
  const snapshot = await readShopperGpuOccupancy();
  const scaled = await scaleShopperDeployment(snapshot.occupancy);
  return {
    occupancy: snapshot.occupancy,
    cap: snapshot.cap,
    minInstancesUpdated: scaled.minInstancesUpdated,
  };
}

/** Operator keepalive still pins a single warm replica. Shopper path uses leases. */
export async function warmGpuForShopperSubmit(): Promise<void> {
  await setReplicateSessionGpu('warm');
}

/**
 * PATCH replicas for this shopper. Wait the cold-start budget only when a new
 * replica was added; otherwise a short settle so a warming image is not empty.
 */
export async function warmAndWaitForShopperGpu(
  tenantId: string,
  sessionKey: string,
  maxWaitMs = GPU_COLD_START_WAIT_MS,
): Promise<void> {
  const started = Date.now();
  const claimed = await claimShopperGpuSession(tenantId, sessionKey);
  const snapshot = await readShopperGpuOccupancy();
  const budget = claimed.created && snapshot.occupancy <= 1
    ? Math.max(0, Math.min(GPU_COLD_START_WAIT_MS, maxWaitMs))
    : Math.max(0, Math.min(GPU_WARM_SETTLE_WAIT_MS, maxWaitMs));
  const remaining = budget - (Date.now() - started);
  if (remaining > 0) {
    await sleep(remaining);
  }
}

export async function settleWarmReplicaIfNeeded(convertedLease: boolean): Promise<void> {
  if (!convertedLease) {
    return;
  }

  await sleep(GPU_WARM_SETTLE_WAIT_MS);
}

export async function holdGpuForFitJob(jobId: string, holdMs: number): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from('fit_jobs')
    .update({ gpu_hold_until: new Date(Date.now() + holdMs).toISOString() })
    .eq('id', jobId);

  if (error) {
    return;
  }
}

export async function releaseGpuHoldForFitJob(jobId: string): Promise<void> {
  const supabase = createServiceClient();
  await supabase.from('fit_jobs').update({ gpu_hold_until: null }).eq('id', jobId);
}

/**
 * Sleep the Deployment when no body job, drape hold, or capture lease remains.
 */
export async function sleepGpuIfNoActiveFitJobs(): Promise<void> {
  const supabase = createServiceClient();
  await supabase
    .from('shopper_gpu_sessions')
    .delete()
    .lte('expires_at', new Date().toISOString());

  const [activeBodyJobCount, activeDrapeHoldCount, warmupLeaseCount] = await Promise.all([
    countActiveBodyJobs(),
    countDrapeHolds(),
    countWarmupLeases(),
  ]);

  if (
    !sessionGpuShouldSleep({
      activeBodyJobCount,
      activeDrapeHoldCount,
      warmupLeaseCount,
    })
  ) {
    await scaleShopperDeployment(
      shopperGpuOccupancy({ activeBodyJobCount, warmupLeaseCount }),
    );
    return;
  }

  await setReplicateSessionGpu('sleep');
}
