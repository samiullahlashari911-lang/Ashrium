import { scaleModalGpu, setModalSessionGpu } from '@/lib/ml/gpu';
import {
  FITTING_ROOM_AT_CAPACITY_MESSAGE,
  SHOPPER_GPU_WARMUP_IDLE_MS,
  containersForOccupancy,
  readShopperGpuMaxInstances,
  sessionGpuShouldSleep,
  shopperGpuActiveLookbackMs,
  shopperGpuCapacity,
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

function isMissingGpuSessionTable(error: { message?: string; code?: string } | null | undefined): boolean {
  const message = error?.message ?? '';
  return (
    error?.code === '42P01'
    || error?.code === 'PGRST205'
    || /shopper_gpu_sessions/i.test(message)
  );
}

async function countActiveBodyJobs(): Promise<number> {
  const supabase = createServiceClient();
  const cutoff = new Date(Date.now() - shopperGpuActiveLookbackMs()).toISOString();
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
  const n = Math.min(cap, containersForOccupancy(occupancy));
  const patched = await scaleModalGpu(n);
  return { minInstancesUpdated: patched.minContainersUpdated };
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
    if (before.occupancy >= shopperGpuCapacity(before.cap)) {
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
    if (!isMissingGpuSessionTable(error)) {
      throw new Error(error.message);
    }
  }

  const occupancy = error && isMissingGpuSessionTable(error)
    ? Math.max(1, (await readShopperGpuOccupancy()).occupancy)
    : (await readShopperGpuOccupancy()).occupancy;
  const scaled = await scaleShopperDeployment(occupancy);
  return {
    minInstancesUpdated: scaled.minInstancesUpdated || !refreshingLive,
    created: !refreshingLive,
  };
}

export async function deleteShopperGpuSession(
  tenantId: string,
  sessionKey: string,
): Promise<void> {
  const key = sessionKey.trim();
  if (key.length < 8 || key.length > 80) {
    return;
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('shopper_gpu_sessions')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('session_key', key);

  if (error && !isMissingGpuSessionTable(error)) {
    return;
  }
}

export async function releaseShopperGpuSession(
  tenantId: string,
  sessionKey: string,
): Promise<void> {
  await deleteShopperGpuSession(tenantId, sessionKey);
  await sleepGpuIfNoActiveFitJobs();
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
  await setModalSessionGpu('warm');
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
 * Sleep Modal replicas when no body job, drape hold, or capture lease remains.
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

  await setModalSessionGpu('sleep');
}

/** Operator demo window (`POST /api/v1/hmr/keepalive {action: 'demo'}`): one lease, never a shopper's. */
export const DEMO_GPU_SESSION_KEY = 'operator-demo-window';
export const DEMO_GPU_WINDOW_MAX_MINUTES = 10;

/**
 * Keep one GPU warm for `minutes` (a live pitch): a lease like a shopper's, so
 * finished try-ons inside the window do not put it to sleep, and the window's
 * own expiry does (`watchDemoGpuWindow`).
 */
export async function openDemoGpuWindow(
  tenantId: string,
  minutes: number,
): Promise<{ expiresAt: string; minInstancesUpdated: boolean }> {
  const span = Math.min(DEMO_GPU_WINDOW_MAX_MINUTES, Math.max(1, minutes));
  const expiresAt = new Date(Date.now() + span * 60_000).toISOString();
  const supabase = createServiceClient();
  const { error } = await supabase.from('shopper_gpu_sessions').upsert(
    { tenant_id: tenantId, session_key: DEMO_GPU_SESSION_KEY, expires_at: expiresAt },
    { onConflict: 'tenant_id,session_key' },
  );
  if (error) {
    throw new Error(error.message);
  }
  const scaled = await scaleShopperGpuToOccupancy();
  return { expiresAt, minInstancesUpdated: scaled.minInstancesUpdated };
}

/** When the demo window ends (ms epoch), or null when none is open. */
export async function demoGpuWindowEndsAt(): Promise<number | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('shopper_gpu_sessions')
    .select('expires_at')
    .eq('session_key', DEMO_GPU_SESSION_KEY)
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const endsAt = data ? Date.parse(data.expires_at) : Number.NaN;
  return Number.isFinite(endsAt) ? endsAt : null;
}

export async function closeDemoGpuWindow(): Promise<void> {
  const supabase = createServiceClient();
  await supabase.from('shopper_gpu_sessions').delete().eq('session_key', DEMO_GPU_SESSION_KEY);
}
