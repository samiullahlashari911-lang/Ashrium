import { headlessKeepBox } from '@/lib/widget/webp-encode';
import type { CaptureView, PoseGateStatus } from '@/types/hmr';

export interface PoseLandmarkSample {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

const NOSE = 0;
const LEFT_EYE = 2;
const RIGHT_EYE = 5;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_WRIST = 15;
const RIGHT_WRIST = 16;
const LEFT_HIP = 23;
const RIGHT_HIP = 24;
const LEFT_KNEE = 25;
const RIGHT_KNEE = 26;
const LEFT_ANKLE = 27;
const RIGHT_ANKLE = 28;
const FOOT_POINTS = [29, 30, 31, 32] as const;

const FRONT_REQUIRED = [
  LEFT_SHOULDER,
  RIGHT_SHOULDER,
  LEFT_WRIST,
  RIGHT_WRIST,
  LEFT_HIP,
  RIGHT_HIP,
] as const;

/**
 * Where the drawn outline's body sits in the capture view, normalized to the
 * view (0-1): crown, soles, and the torso centre line.
 */
export interface OutlineFrame {
  top: number;
  bottom: number;
  centerX: number;
}

/** How the raw camera frame is drawn in the view: `object-cover`, optionally mirrored. */
export interface ViewMapping {
  videoWidth: number;
  videoHeight: number;
  viewWidth: number;
  viewHeight: number;
  mirrored: boolean;
}

export interface PoseGateContext {
  mapping: ViewMapping;
  /** The on-screen outline. Without it (gallery import) a loose framing band applies. */
  outline?: OutlineFrame;
  /** Smoothed landmark motion per detection, as a fraction of body height. */
  motion?: number;
  /** Red for `RELAX_AFTER_MS`: enter at the looser hold thresholds. */
  relaxed?: boolean;
}

/**
 * Enter thresholds start a hold; the looser hold thresholds keep it, so a body
 * near an edge does not chatter between red and green.
 */
interface GateThresholds {
  /** |body height / outline height - 1|. */
  scale: number;
  /** Crown or soles off the outline's, as a fraction of outline height. */
  edge: number;
  /** Torso centre off the outline's, as a fraction of outline height. */
  center: number;
  /** Torso lean from vertical, degrees. */
  torsoTiltDeg: number;
  /** Hip-knee-ankle angle; a straight leg is 180. */
  kneeMinDeg: number;
  /** Shoulder-to-hip over hip-to-ankle length; bending toward the camera shortens the torso. */
  torsoLegMin: number;
  motion: number;
}

export const GATE_ENTER: GateThresholds = {
  scale: 0.12,
  edge: 0.1,
  center: 0.1,
  torsoTiltDeg: 20,
  kneeMinDeg: 145,
  torsoLegMin: 0.43,
  motion: 0.012,
};

export const GATE_HOLD: GateThresholds = {
  scale: 0.16,
  edge: 0.14,
  center: 0.14,
  torsoTiltDeg: 25,
  kneeMinDeg: 138,
  torsoLegMin: 0.4,
  motion: 0.02,
};

/**
 * Red this long and the gate starts at its hold thresholds instead: nobody is
 * stuck fiddling, while the head, feet, upright and still checks the body fit
 * needs stay (owner, 2026-10-11).
 */
export const RELAX_AFTER_MS = 15_000;

/** Crown above the eyes, as a fraction of the eye-to-shoulder drop (adult anthropometry ~0.65). */
const CROWN_ABOVE_EYES = 0.65;
/** Soles below the ankle joint when no heel or toe point is visible, as a fraction of shoulder-to-ankle. */
const SOLE_BELOW_ANKLE = 0.05;
/** Gallery photos (no outline): crown-to-sole share of the frame. */
const LOOSE_BODY_MIN = 0.55;
const LOOSE_BODY_MAX = 0.98;

function isVisible(landmark: PoseLandmarkSample | undefined, minimum = 0.45): landmark is PoseLandmarkSample {
  return landmark !== undefined && (landmark.visibility ?? 0) >= minimum;
}

function midpoint(a: PoseLandmarkSample, b: PoseLandmarkSample): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** A raw-frame landmark in view coordinates (0-1 of the visible capture box). */
export function toView(point: { x: number; y: number }, mapping: ViewMapping): { x: number; y: number } {
  const scale = Math.max(mapping.viewWidth / mapping.videoWidth, mapping.viewHeight / mapping.videoHeight);
  const drawnWidth = mapping.videoWidth * scale;
  const drawnHeight = mapping.videoHeight * scale;
  const x = mapping.mirrored ? 1 - point.x : point.x;
  return {
    x: ((mapping.viewWidth - drawnWidth) / 2 + x * drawnWidth) / mapping.viewWidth,
    y: ((mapping.viewHeight - drawnHeight) / 2 + point.y * drawnHeight) / mapping.viewHeight,
  };
}

/** Crown of the head in raw-frame y. MediaPipe Pose has no crown point. */
export function estimateCrownY(landmarks: readonly PoseLandmarkSample[]): number | null {
  const shoulders = [landmarks[LEFT_SHOULDER], landmarks[RIGHT_SHOULDER]].filter((p) => isVisible(p));
  const eyes = [landmarks[LEFT_EYE], landmarks[RIGHT_EYE]].filter((p) => isVisible(p, 0.5));
  const nose = landmarks[NOSE];
  const eyePoints = eyes.length > 0 ? eyes : isVisible(nose, 0.5) ? [nose] : [];
  if (shoulders.length === 0 || eyePoints.length === 0) {
    return null;
  }
  const eyeY = eyePoints.reduce((sum, p) => sum + p.y, 0) / eyePoints.length;
  const shoulderY = shoulders.reduce((sum, p) => sum + p.y, 0) / shoulders.length;
  return eyeY - CROWN_ABOVE_EYES * Math.max(shoulderY - eyeY, 0);
}

/** Soles in raw-frame y: the lowest visible heel or toe, else just under the ankles. */
export function estimateSoleY(landmarks: readonly PoseLandmarkSample[]): number | null {
  const feet = FOOT_POINTS.map((index) => landmarks[index]).filter((p) => isVisible(p, 0.3));
  if (feet.length > 0) {
    return Math.max(...feet.map((p) => p.y));
  }
  const ankles = [landmarks[LEFT_ANKLE], landmarks[RIGHT_ANKLE]].filter((p) => isVisible(p, 0.3));
  const shoulder = landmarks[LEFT_SHOULDER] ?? landmarks[RIGHT_SHOULDER];
  if (ankles.length === 0 || !shoulder) {
    return null;
  }
  const ankleY = Math.max(...ankles.map((p) => p.y));
  return ankleY + SOLE_BELOW_ANKLE * Math.max(ankleY - shoulder.y, 0);
}

function angleDeg(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const denominator = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
  if (denominator === 0) {
    return 180;
  }
  const cos = Math.min(1, Math.max(-1, (abx * cbx + aby * cby) / denominator));
  return (Math.acos(cos) * 180) / Math.PI;
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
      return 'Lift your arms straight out to shoulder height';
    case 'off_center':
      return 'Move to the middle of the outline';
    case 'fit_outline':
      return 'Tilt your phone so your head and feet meet the outline';
    case 'show_head':
      return 'Keep your whole head in the picture';
    case 'stand_straight':
      return 'Stand up straight, legs straight';
    case 'hold_still':
      return 'Hold still';
    case 'arms_closed':
      return 'Hold your arms a little away from your body';
    case 'arms_too_high':
      return 'Lower your arms, slightly away from your sides';
    case 'not_detected':
      return view === 'front'
        ? 'Step back so your whole body and feet are in view'
        : 'Turn sideways with your whole body and feet in view';
  }
}

/**
 * The capture gate. Green only when the shopper stands upright, matches the
 * on-screen outline, has their whole head in the picture, holds the capture
 * pose, and is still: the frame the avatar is built from and the frame the
 * shopper sees themselves in. Pixel-space geometry (aspect from `mapping`)
 * keeps angles honest on a 3:4 camera frame.
 */
export function evaluatePoseGate(
  landmarks: readonly PoseLandmarkSample[],
  view: CaptureView,
  previous?: PoseGateStatus,
  context?: PoseGateContext,
): PoseGateStatus {
  const limits = previous === 'aligned' || context?.relaxed ? GATE_HOLD : GATE_ENTER;
  const required = view === 'front'
    ? FRONT_REQUIRED
    : [LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_HIP, RIGHT_HIP];
  if (!required.every((index) => isVisible(landmarks[index]))) {
    return 'not_detected';
  }
  const leftShoulder = landmarks[LEFT_SHOULDER];
  const rightShoulder = landmarks[RIGHT_SHOULDER];
  const leftHip = landmarks[LEFT_HIP];
  const rightHip = landmarks[RIGHT_HIP];
  const ankles = [landmarks[LEFT_ANKLE], landmarks[RIGHT_ANKLE]].filter((p) => isVisible(p, 0.3));
  if (ankles.length === 0) {
    return 'not_detected';
  }

  // Pixel space: x scaled by the frame aspect so lengths and angles are true.
  const aspect = context ? context.mapping.videoWidth / context.mapping.videoHeight : 1;
  const px = (p: { x: number; y: number }): { x: number; y: number } => ({ x: p.x * aspect, y: p.y });

  const shoulderMid = px(midpoint(leftShoulder, rightShoulder));
  const hipMid = px(midpoint(leftHip, rightHip));
  const ankleMid = px({
    x: ankles.reduce((sum, p) => sum + p.x, 0) / ankles.length,
    y: ankles.reduce((sum, p) => sum + p.y, 0) / ankles.length,
  });
  const torsoLength = Math.hypot(shoulderMid.x - hipMid.x, shoulderMid.y - hipMid.y);
  const legLength = Math.hypot(hipMid.x - ankleMid.x, hipMid.y - ankleMid.y);
  if (torsoLength === 0 || legLength === 0) {
    return 'not_detected';
  }

  const shoulderWidth = Math.abs(px(leftShoulder).x - px(rightShoulder).x);
  const facing = shoulderWidth / torsoLength;
  if (view === 'front' ? facing < 0.45 : facing > 0.45) {
    return 'turn_required';
  }

  // Upright: torso near vertical and full length, hips over the feet, knees straight.
  const tilt = (Math.atan2(Math.abs(shoulderMid.x - hipMid.x), hipMid.y - shoulderMid.y) * 180) / Math.PI;
  const legLean = Math.abs(hipMid.x - ankleMid.x) / legLength;
  const kneesBent = [
    [LEFT_HIP, LEFT_KNEE, LEFT_ANKLE],
    [RIGHT_HIP, RIGHT_KNEE, RIGHT_ANKLE],
  ].some(([hip, knee, ankle]) => {
    const k = landmarks[knee];
    const a = landmarks[ankle];
    if (!isVisible(k, 0.5) || !isVisible(a, 0.5)) {
      return false;
    }
    return angleDeg(px(landmarks[hip]), px(k), px(a)) < limits.kneeMinDeg;
  });
  if (
    shoulderMid.y >= hipMid.y
    || tilt > limits.torsoTiltDeg
    || torsoLength / legLength < limits.torsoLegMin
    || legLean > 0.35
    || kneesBent
  ) {
    return 'stand_straight';
  }

  const crownRaw = estimateCrownY(landmarks);
  const soleRaw = estimateSoleY(landmarks);
  if (soleRaw === null) {
    return 'not_detected';
  }
  if (crownRaw === null) {
    return 'show_head';
  }

  const mapping = context?.mapping;
  const inView = (p: { x: number; y: number }): { x: number; y: number } => (mapping ? toView(p, mapping) : p);
  const crown = inView({ x: 0, y: crownRaw }).y;
  const sole = inView({ x: 0, y: soleRaw }).y;
  const torsoCenterX = inView(midpoint(midpoint(leftShoulder, rightShoulder), midpoint(leftHip, rightHip))).x;
  const bodyHeight = sole - crown;

  const outline = context?.outline;
  if (outline) {
    const outlineHeight = outline.bottom - outline.top;
    const scale = bodyHeight / outlineHeight;
    if (scale > 1 + limits.scale) {
      return 'too_close';
    }
    if (scale < 1 - limits.scale) {
      return 'too_far';
    }
    if (sole > 0.995) {
      return 'not_detected';
    }
    if (
      Math.abs(crown - outline.top) > limits.edge * outlineHeight
      || Math.abs(sole - outline.bottom) > limits.edge * outlineHeight
    ) {
      return 'fit_outline';
    }
    if (Math.abs(torsoCenterX - outline.centerX) > limits.center * outlineHeight) {
      return 'off_center';
    }
  } else {
    if (bodyHeight > LOOSE_BODY_MAX || crown < 0 || sole > 1) {
      return 'too_close';
    }
    if (bodyHeight < LOOSE_BODY_MIN) {
      return 'too_far';
    }
    if (torsoCenterX < 0.3 || torsoCenterX > 0.7) {
      return 'off_center';
    }
  }

  // The whole head in the picture: the crown and every face point inside the
  // visible view, and a face the on-device crop can find. The pose model also
  // places face points off-frame with high confidence, so position counts.
  const facePoints = [landmarks[NOSE], landmarks[LEFT_EYE], landmarks[RIGHT_EYE]]
    .filter((p) => isVisible(p, 0.5))
    .map(inView);
  if (
    crown < 0.005
    || facePoints.length === 0
    || facePoints.some((p) => p.x < 0.01 || p.x > 0.99 || p.y < 0.01 || p.y > 0.99)
    || !headlessKeepBox(landmarks, 1000, 1000)
  ) {
    return 'show_head';
  }

  if (view === 'side') {
    const visible: Array<{ wrist: PoseLandmarkSample; shoulder: PoseLandmarkSample }> = [];
    if (isVisible(landmarks[LEFT_WRIST], 0.35)) {
      visible.push({ wrist: landmarks[LEFT_WRIST], shoulder: leftShoulder });
    }
    if (isVisible(landmarks[RIGHT_WRIST], 0.35)) {
      visible.push({ wrist: landmarks[RIGHT_WRIST], shoulder: rightShoulder });
    }
    const raised = visible.every(({ wrist, shoulder }) => px(wrist).y <= px(shoulder).y + 0.12 * torsoLength);
    if (visible.length === 0 || !raised) {
      return 'raise_wrists';
    }
  } else {
    const leftWrist = px(landmarks[LEFT_WRIST]);
    const rightWrist = px(landmarks[RIGHT_WRIST]);
    const hipWidth = Math.abs(px(leftHip).x - px(rightHip).x);
    const wristsTooHigh =
      leftWrist.y < px(leftShoulder).y - 0.25 * torsoLength
      && rightWrist.y < px(rightShoulder).y - 0.25 * torsoLength;
    if (wristsTooHigh) {
      return 'arms_too_high';
    }
    if (Math.abs(leftWrist.x - rightWrist.x) <= hipWidth + 0.1 * torsoLength) {
      return 'arms_closed';
    }
  }

  if (context?.motion !== undefined && context.motion > limits.motion) {
    return 'hold_still';
  }

  return 'aligned';
}
