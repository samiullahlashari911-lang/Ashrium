/** Counted steps after consent; consent itself is the threshold, not a step. */
export const CAPTURE_FLOW_TOTAL_STEPS = 5;

export type CaptureFlowStep = 'consent' | 'height' | 'sex' | 'weight' | 'front' | 'side';

const STEP_INDEX: Record<CaptureFlowStep, number> = {
  consent: 0,
  height: 1,
  sex: 2,
  weight: 3,
  front: 4,
  side: 5,
};

const STEP_TITLE: Record<CaptureFlowStep, string> = {
  consent: 'Consent',
  height: 'Height',
  sex: 'Body profile',
  weight: 'Weight',
  front: 'Front photo',
  side: 'Side photo',
};

export function captureFlowProgress(step: CaptureFlowStep): {
  current: number;
  total: number;
  /** 0–1 fill for the progress line; reaching a step fills up to it. */
  fraction: number;
  title: string;
  statusLine: string;
} {
  const current = STEP_INDEX[step];
  return {
    current,
    total: CAPTURE_FLOW_TOTAL_STEPS,
    fraction: current / CAPTURE_FLOW_TOTAL_STEPS,
    title: STEP_TITLE[step],
    statusLine:
      current === 0
        ? STEP_TITLE[step]
        : `Step ${current} of ${CAPTURE_FLOW_TOTAL_STEPS} · ${STEP_TITLE[step]}`,
  };
}
