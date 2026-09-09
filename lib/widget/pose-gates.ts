import type { CaptureView, PoseGateStatus } from '@/types/hmr';

export interface PoseLandmarkSample {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_WRIST = 15;
const RIGHT_WRIST = 16;
const LEFT_HIP = 23;
const RIGHT_HIP = 24;
const LEFT_ANKLE = 27;
const RIGHT_ANKLE = 28;

const FRONT_REQUIRED = [
  LEFT_SHOULDER,
  RIGHT_SHOULDER,
  LEFT_WRIST,
  RIGHT_WRIST,
  LEFT_HIP,
  RIGHT_HIP,
] as const;

/**
 * Shoulder-to-ankle height as a fraction of the frame. Entering aligned uses
 * the inner band; staying aligned uses the outer band so filling the outline
 * does not chatter between "step back" and "come closer".
 */
export const POSE_BODY_ENTER_MIN = 0.5;
export const POSE_BODY_ENTER_MAX = 0.88;
export const POSE_BODY_HOLD_MIN = 0.42;
export const POSE_BODY_HOLD_MAX = 0.93;
export const POSE_EDGE_ENTER = 0.02;
export const POSE_EDGE_HOLD = 0.005;

function isVisible(landmark: PoseLandmarkSample | undefined, minimum = 0.45): boolean {
  return landmark !== undefined && (landmark.visibility ?? 0) >= minimum;
}

function atLeastOneVisible(
  left: PoseLandmarkSample | undefined,
  right: PoseLandmarkSample | undefined,
  minimum: number,
): boolean {
  return isVisible(left, minimum) || isVisible(right, minimum);
}

export function gateStatusCopy(status: PoseGateStatus, view: CaptureView): string {
  switch (status) {
    case 'aligned':
      return 'Hold still — capturing';
    case 'too_close':
      return 'Step back a little';
    case 'too_far':
      return 'Take one step closer';
    case 'turn_required':
      return view === 'front' ? 'Face the camera' : 'Turn 90° to your side';
    case 'raise_wrists':
      return 'Lift your wrists to your shoulders';
    case 'not_detected':
      return view === 'front'
        ? 'Stand in the outline with arms slightly open'
        : 'Step into the outline, then raise your wrists';
  }
}

export function evaluatePoseGate(
  landmarks: readonly PoseLandmarkSample[],
  view: CaptureView,
  previous?: PoseGateStatus,
): PoseGateStatus {
  if (view === 'front') {
    if (!FRONT_REQUIRED.every((index) => isVisible(landmarks[index]))) {
      return 'not_detected';
    }
  } else if (
    !isVisible(landmarks[LEFT_SHOULDER])
    || !isVisible(landmarks[RIGHT_SHOULDER])
    || !isVisible(landmarks[LEFT_HIP])
    || !isVisible(landmarks[RIGHT_HIP])
  ) {
    return 'not_detected';
  }

  if (!atLeastOneVisible(landmarks[LEFT_ANKLE], landmarks[RIGHT_ANKLE], 0.3)) {
    return 'not_detected';
  }

  const holding = previous === 'aligned';
  const heightMin = holding ? POSE_BODY_HOLD_MIN : POSE_BODY_ENTER_MIN;
  const heightMax = holding ? POSE_BODY_HOLD_MAX : POSE_BODY_ENTER_MAX;
  const edge = holding ? POSE_EDGE_HOLD : POSE_EDGE_ENTER;

  const bodyPoints = [
    landmarks[LEFT_SHOULDER],
    landmarks[RIGHT_SHOULDER],
    landmarks[LEFT_HIP],
    landmarks[RIGHT_HIP],
    landmarks[LEFT_ANKLE],
    landmarks[RIGHT_ANKLE],
  ].filter((landmark): landmark is PoseLandmarkSample => landmark !== undefined);

  const minX = Math.min(...bodyPoints.map((landmark) => landmark.x));
  const maxX = Math.max(...bodyPoints.map((landmark) => landmark.x));
  const minY = Math.min(...bodyPoints.map((landmark) => landmark.y));
  const maxY = Math.max(...bodyPoints.map((landmark) => landmark.y));
  const bodyHeight = maxY - minY;
  const centerX = (minX + maxX) / 2;

  if (minY < edge || maxY > 1 - edge || bodyHeight > heightMax) {
    return 'too_close';
  }

  if (bodyHeight < heightMin) {
    return 'too_far';
  }

  if (centerX < 0.24 || centerX > 0.76) {
    return 'not_detected';
  }

  const leftShoulder = landmarks[LEFT_SHOULDER];
  const rightShoulder = landmarks[RIGHT_SHOULDER];
  if (!leftShoulder || !rightShoulder) {
    return 'not_detected';
  }

  const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);

  if (view === 'side') {
    if (shoulderWidth > 0.18) {
      return 'turn_required';
    }

    const leftWrist = landmarks[LEFT_WRIST];
    const rightWrist = landmarks[RIGHT_WRIST];
    const leftWristVisible = isVisible(leftWrist, 0.35);
    const rightWristVisible = isVisible(rightWrist, 0.35);
    if (!leftWristVisible && !rightWristVisible) {
      return 'raise_wrists';
    }

    const leftRaised = !leftWristVisible || leftWrist.y <= leftShoulder.y + 0.04;
    const rightRaised = !rightWristVisible || rightWrist.y <= rightShoulder.y + 0.04;
    if (!leftRaised || !rightRaised) {
      return 'raise_wrists';
    }

    return 'aligned';
  }

  if (shoulderWidth < 0.11) {
    return 'turn_required';
  }

  const leftWrist = landmarks[LEFT_WRIST];
  const rightWrist = landmarks[RIGHT_WRIST];
  const leftHip = landmarks[LEFT_HIP];
  const rightHip = landmarks[RIGHT_HIP];
  const wristsOpen =
    Math.abs(leftWrist.x - rightWrist.x) > Math.abs(leftHip.x - rightHip.x) + 0.02;
  const wristsTooHigh =
    leftWrist.y < leftShoulder.y - 0.1 && rightWrist.y < rightShoulder.y - 0.1;

  if (!wristsOpen || wristsTooHigh) {
    return 'not_detected';
  }

  return 'aligned';
}
