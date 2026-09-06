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
  LEFT_ANKLE,
  RIGHT_ANKLE,
] as const;

const SIDE_REQUIRED = [
  LEFT_SHOULDER,
  RIGHT_SHOULDER,
  LEFT_HIP,
  RIGHT_HIP,
  LEFT_ANKLE,
  RIGHT_ANKLE,
] as const;

function isVisible(landmark: PoseLandmarkSample | undefined, minimum = 0.5): boolean {
  return landmark !== undefined && (landmark.visibility ?? 0) >= minimum;
}

export function gateStatusCopy(status: PoseGateStatus, view: CaptureView): string {
  switch (status) {
    case 'aligned':
      return 'Hold still';
    case 'too_close':
      return 'Step back';
    case 'too_far':
      return 'Come closer';
    case 'turn_required':
      return view === 'front' ? 'Face the camera' : 'Turn to your side';
    case 'raise_wrists':
      return 'Raise your wrists to your shoulders';
    case 'not_detected':
      return view === 'front' ? 'Stand in the outline, arms open' : 'Step into the outline';
  }
}

export function evaluatePoseGate(
  landmarks: readonly PoseLandmarkSample[],
  view: CaptureView,
): PoseGateStatus {
  const required = view === 'front' ? FRONT_REQUIRED : SIDE_REQUIRED;
  if (!required.every((index) => isVisible(landmarks[index]))) {
    return 'not_detected';
  }

  const samples = required.map((index) => landmarks[index]);
  const minX = Math.min(...samples.map((landmark) => landmark.x));
  const maxX = Math.max(...samples.map((landmark) => landmark.x));
  const minY = Math.min(...samples.map((landmark) => landmark.y));
  const maxY = Math.max(...samples.map((landmark) => landmark.y));
  const bodyHeight = maxY - minY;
  const centerX = (minX + maxX) / 2;

  if (minY < 0.04 || maxY > 0.96 || bodyHeight > 0.9) {
    return 'too_close';
  }

  if (bodyHeight < 0.52) {
    return 'too_far';
  }

  if (centerX < 0.28 || centerX > 0.72) {
    return 'not_detected';
  }

  const leftShoulder = landmarks[LEFT_SHOULDER];
  const rightShoulder = landmarks[RIGHT_SHOULDER];
  const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);

  if (view === 'side') {
    if (shoulderWidth > 0.16) {
      return 'turn_required';
    }

    const leftWrist = landmarks[LEFT_WRIST];
    const rightWrist = landmarks[RIGHT_WRIST];
    const leftWristVisible = isVisible(leftWrist);
    const rightWristVisible = isVisible(rightWrist);
    if (!leftWristVisible && !rightWristVisible) {
      return 'raise_wrists';
    }

    const leftRaised = !leftWristVisible || leftWrist.y <= leftShoulder.y;
    const rightRaised = !rightWristVisible || rightWrist.y <= rightShoulder.y;
    if (!leftRaised || !rightRaised) {
      return 'raise_wrists';
    }

    return 'aligned';
  }

  if (shoulderWidth < 0.12) {
    return 'turn_required';
  }

  const leftWrist = landmarks[LEFT_WRIST];
  const rightWrist = landmarks[RIGHT_WRIST];
  const leftHip = landmarks[LEFT_HIP];
  const rightHip = landmarks[RIGHT_HIP];
  const wristsOpen =
    Math.abs(leftWrist.x - rightWrist.x) > Math.abs(leftHip.x - rightHip.x) + 0.04;
  const wristsDropped = leftWrist.y > leftShoulder.y && rightWrist.y > rightShoulder.y;

  if (!wristsOpen || !wristsDropped) {
    return 'not_detected';
  }

  return 'aligned';
}
