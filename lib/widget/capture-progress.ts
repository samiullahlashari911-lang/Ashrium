/** Counted steps after consent; consent itself is the threshold, not a step. */
export const CAPTURE_FLOW_TOTAL_STEPS = 4;

export type CaptureFlowStep = 'consent' | 'body' | 'mode' | 'front' | 'side';

const STEP_INDEX: Record<CaptureFlowStep, number> = {
  consent: 0,
  body: 1,
  mode: 2,
  front: 3,
  side: 4,
};

const STEP_TITLE: Record<CaptureFlowStep, string> = {
  consent: 'Consent',
  body: 'About you',
  mode: 'Photo setup',
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
