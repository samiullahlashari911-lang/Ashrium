import { GPU_HOLD_DURING_DRAPE_MS } from '@/lib/ml/session-gpu';

/**
 * Shopper-facing avatar build stages. Every label maps to something that is
 * really happening — the loader never advances on a timer. Fine-grained GPU
 * stages arrive from the Modal app via `/api/v1/hmr/progress`; without them
 * the widget falls back to what the job status proves.
 */
export type AvatarStageKey =
  | 'crop'
  | 'upload'
  | 'gpu'
  | 'silhouettes'
  | 'body'
  | 'measure'
  | 'place'
  | 'dress'
  | 'ready';

export const AVATAR_STAGE_ORDER: readonly AvatarStageKey[] = [
  'crop',
  'upload',
  'gpu',
  'silhouettes',
  'body',
  'measure',
  'place',
  'dress',
  'ready',
];

export const AVATAR_STAGE_LABEL: Record<AvatarStageKey, { active: string; done: string }> = {
  crop: { active: 'Removing your face on this phone', done: 'Face removed on your phone' },
  upload: { active: 'Uploading securely', done: 'Photos uploaded securely' },
  gpu: { active: 'Waking the fitting studio', done: 'Fitting studio ready' },
  silhouettes: { active: 'Finding your outline', done: 'Outline found' },
  body: { active: 'Building your 3D body', done: '3D body built' },
  measure: { active: 'Taking your measurements', done: 'Measurements taken' },
  place: { active: 'Putting your avatar together', done: 'Avatar put together' },
  dress: { active: 'Dressing you in your size', done: 'Dressed in your size' },
  ready: { active: 'Your avatar is ready', done: 'Your avatar is ready' },
};

/** Stages the GPU may report; anything else from the wire is ignored. */
export const GPU_REPORTED_STAGES: ReadonlySet<AvatarStageKey> = new Set([
  'silhouettes',
  'body',
  'measure',
]);

export function isAvatarStageKey(value: unknown): value is AvatarStageKey {
  return typeof value === 'string' && (AVATAR_STAGE_ORDER as readonly string[]).includes(value);
}

export interface AvatarStageView {
  key: AvatarStageKey;
  label: string;
  state: 'done' | 'active' | 'pending';
}

/**
 * Stages that did not happen (e.g. no drape for this product) are skipped,
 * never shown as done.
 */
export function avatarStageViews(
  current: AvatarStageKey,
  skipped: ReadonlySet<AvatarStageKey> = new Set(),
): AvatarStageView[] {
  const order = AVATAR_STAGE_ORDER.filter((key) => key === current || !skipped.has(key));
  const currentIndex = order.indexOf(current);
  return order.map((key, index) => {
    const state = index < currentIndex ? 'done' : index === currentIndex ? 'active' : 'pending';
    return {
      key,
      label: state === 'done' ? AVATAR_STAGE_LABEL[key].done : AVATAR_STAGE_LABEL[key].active,
      state,
    };
  });
}

/** What the fitting room still has to prove after the GPU job completes. */
export type AvatarRevealStage = 'place' | 'dress' | 'ready';

/**
 * Derives the current stage from what the client can prove: upload progress,
 * the job's public status, (when present) the GPU-reported stage, and — once
 * the job completes — whether the 3D body is rendered and dressed.
 */
export function currentAvatarStage(input: {
  uploading: boolean;
  jobStatus: 'pending' | 'processing' | 'completed' | 'failed' | null;
  gpuStage: AvatarStageKey | null;
  reveal?: AvatarRevealStage | null;
}): AvatarStageKey {
  if (input.uploading) {
    return 'upload';
  }
  if (input.jobStatus === 'completed') {
    return input.reveal ?? 'ready';
  }
  if (input.gpuStage && GPU_REPORTED_STAGES.has(input.gpuStage)) {
    return input.gpuStage;
  }
  if (input.jobStatus === 'processing') {
    return 'body';
  }
  return 'gpu';
}

/**
 * The shopper first sees themselves dressed (spec Q3). The server gives a
 * Newton drape at most `GPU_HOLD_DURING_DRAPE_MS`; the loader waits that long
 * plus network slack, so a drape that is still allowed to land is never cut
 * off (a 90 s cap here showed an undressed avatar while a 120 s drape ran).
 * Past it the drape is treated as failed: the shopper in their own clothes,
 * with an honest message; a late drape still pours on.
 */
export const REVEAL_HOLD_MAX_MS = GPU_HOLD_DURING_DRAPE_MS + 15_000;
