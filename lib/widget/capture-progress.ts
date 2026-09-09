export const CAPTURE_FLOW_TOTAL_STEPS = 5;

export type CaptureFlowStep = 'consent' | 'height' | 'profile' | 'front' | 'side';

const STEP_INDEX: Record<CaptureFlowStep, number> = {
  consent: 1,
  height: 2,
  profile: 3,
  front: 4,
  side: 5,
};

const STEP_TITLE: Record<CaptureFlowStep, string> = {
  consent: 'Consent',
  height: 'Height',
  profile: 'You',
  front: 'Front pose',
  side: 'Side pose',
};

export function captureFlowProgress(step: CaptureFlowStep): {
  current: number;
  total: number;
  completed: number;
  title: string;
  statusLine: string;
} {
  const current = STEP_INDEX[step];
  const completed = current - 1;
  return {
    current,
    total: CAPTURE_FLOW_TOTAL_STEPS,
    completed,
    title: STEP_TITLE[step],
    statusLine: `${completed} of ${CAPTURE_FLOW_TOTAL_STEPS} steps complete · ${STEP_TITLE[step]}`,
  };
}
