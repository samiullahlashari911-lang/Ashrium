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
  | 'ready';

export const AVATAR_STAGE_ORDER: readonly AvatarStageKey[] = [
  'crop',
  'upload',
  'gpu',
  'silhouettes',
  'body',
  'measure',
  'ready',
];

export const AVATAR_STAGE_LABEL: Record<AvatarStageKey, { active: string; done: string }> = {
  crop: { active: 'Removing your face on this phone', done: 'Face removed on your phone' },
  upload: { active: 'Uploading securely', done: 'Photos uploaded securely' },
  gpu: { active: 'Waking the fitting studio', done: 'Fitting studio ready' },
  silhouettes: { active: 'Finding your outline', done: 'Outline found' },
  body: { active: 'Building your 3D body', done: '3D body built' },
  measure: { active: 'Taking your measurements', done: 'Measurements taken' },
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

export function avatarStageViews(current: AvatarStageKey): AvatarStageView[] {
  const currentIndex = AVATAR_STAGE_ORDER.indexOf(current);
  return AVATAR_STAGE_ORDER.map((key, index) => {
    const state = index < currentIndex ? 'done' : index === currentIndex ? 'active' : 'pending';
    return {
      key,
      label: state === 'done' ? AVATAR_STAGE_LABEL[key].done : AVATAR_STAGE_LABEL[key].active,
      state,
    };
  });
}

/**
 * Derives the current stage from what the client can prove: upload progress,
 * the job's public status, and (when present) the GPU-reported stage.
 */
export function currentAvatarStage(input: {
  uploading: boolean;
  jobStatus: 'pending' | 'processing' | 'completed' | 'failed' | null;
  gpuStage: AvatarStageKey | null;
}): AvatarStageKey {
  if (input.uploading) {
    return 'upload';
  }
  if (input.jobStatus === 'completed') {
    return 'ready';
  }
  if (input.gpuStage && GPU_REPORTED_STAGES.has(input.gpuStage)) {
    return input.gpuStage;
  }
  if (input.jobStatus === 'processing') {
    return 'body';
  }
  return 'gpu';
}
