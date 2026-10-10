import type { PoseLandmarkSample } from '@/lib/widget/pose-gates';
import type { PoseGateStatus } from '@/types/hmr';

/** Weight of the newest detection (~15 Hz): steadies the points with ~130 ms lag. */
const SMOOTHING_ALPHA = 0.5;
const MOTION_POINTS = [0, 11, 12, 23, 24] as const;
/**
 * Motion is the largest step over the last ~0.5 s of detections: a sway
 * passes through a still instant at each end, which must not read as still.
 */
const MOTION_WINDOW = 8;

/**
 * Exponential smoothing of pose landmarks, plus how far the body moved since
 * the last detection (a fraction of shoulder-to-ankle height). Single-frame
 * jitter from the pose model made the gate flicker between red and green.
 */
export class PoseSmoother {
  private state: PoseLandmarkSample[] | null = null;
  private recentMotion: number[] = [];

  reset(): void {
    this.state = null;
    this.recentMotion = [];
  }

  push(raw: readonly PoseLandmarkSample[]): { landmarks: PoseLandmarkSample[]; motion: number } {
    const previous = this.state;
    const next = raw.map((point, index) => {
      const last = previous?.[index];
      if (!last) {
        return { x: point.x, y: point.y, z: point.z, visibility: point.visibility };
      }
      const blend = (a: number | undefined, b: number | undefined): number | undefined =>
        a === undefined ? b : b === undefined ? a : b + SMOOTHING_ALPHA * (a - b);
      return {
        x: blend(point.x, last.x) ?? point.x,
        y: blend(point.y, last.y) ?? point.y,
        z: blend(point.z, last.z),
        visibility: blend(point.visibility, last.visibility),
      };
    });
    this.state = next;

    if (!previous) {
      return { landmarks: next, motion: 0 };
    }
    const shoulderY = Math.min(next[11]?.y ?? 0, next[12]?.y ?? 0);
    const ankleY = Math.max(next[27]?.y ?? 1, next[28]?.y ?? 1);
    const bodyHeight = Math.max(ankleY - shoulderY, 0.05);
    const moved = MOTION_POINTS.reduce<number>((sum, index) => {
      const a = next[index];
      const b = previous[index];
      return a && b ? sum + Math.hypot(a.x - b.x, a.y - b.y) : sum;
    }, 0);
    this.recentMotion = [...this.recentMotion, moved / MOTION_POINTS.length / bodyHeight].slice(-MOTION_WINDOW);
    return { landmarks: next, motion: Math.max(...this.recentMotion) };
  }
}

/** A brief miss (one wobbly detection) does not restart the hold. */
export const ALIGNED_GRACE_MS = 300;
/** A new instruction must persist this long before it replaces the one shown. */
export const STATUS_SETTLE_MS = 350;

export interface GateHoldState {
  /** What the outline, chip and voice show. */
  shown: PoseGateStatus;
  /** Start of the current aligned hold; null when not holding. */
  alignedSince: number | null;
  /** First non-aligned detection during a hold. */
  missSince: number | null;
  candidate: PoseGateStatus | null;
  candidateSince: number;
}

export const INITIAL_GATE_HOLD: GateHoldState = {
  shown: 'not_detected',
  alignedSince: null,
  missSince: null,
  candidate: null,
  candidateSince: 0,
};

/**
 * Turns per-detection gate results into what the shopper sees: green starts at
 * once, survives misses shorter than ALIGNED_GRACE_MS, and red instructions
 * change only once they have settled. Capture itself still requires the
 * current detection to be aligned.
 */
export function stepGateHold(state: GateHoldState, raw: PoseGateStatus, now: number): GateHoldState {
  if (raw === 'aligned') {
    return {
      shown: 'aligned',
      alignedSince: state.shown === 'aligned' && state.alignedSince !== null ? state.alignedSince : now,
      missSince: null,
      candidate: null,
      candidateSince: now,
    };
  }

  if (state.shown === 'aligned') {
    const missSince = state.missSince ?? now;
    if (now - missSince < ALIGNED_GRACE_MS) {
      return { ...state, missSince };
    }
    return { shown: raw, alignedSince: null, missSince: null, candidate: raw, candidateSince: now };
  }

  const candidateSince = state.candidate === raw ? state.candidateSince : now;
  const settled = now - candidateSince >= STATUS_SETTLE_MS || state.shown === 'not_detected';
  return {
    shown: settled ? raw : state.shown,
    alignedSince: null,
    missSince: null,
    candidate: raw,
    candidateSince,
  };
}
