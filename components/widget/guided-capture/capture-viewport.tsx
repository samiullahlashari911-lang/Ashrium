'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';

import { CaptureFlowMeter } from '@/components/widget/guided-capture/capture-flow-meter';
import { SilhouetteOverlay } from '@/components/widget/guided-capture/silhouette-overlay';
import {
  detectStillLandmarks,
  type PoseLandmarkerHandle,
} from '@/components/widget/guided-capture/use-pose-landmarker';
import { subscribeViewportActivity } from '@/lib/graphics/viewport-activity';
import { CAPTURE_CLOTHING_TIP, CAPTURE_PRIVACY_NOTE } from '@/lib/privacy/consent-copy';
import type { CaptureFlowStep } from '@/lib/widget/capture-progress';
import {
  CaptureVoice,
  captureVoiceSupported,
  readVoiceMuted,
  writeVoiceMuted,
} from '@/lib/widget/capture-voice';
import { FRAME_QUALITY_COPY, assessCanvasQuality } from '@/lib/widget/frame-quality';
import {
  evaluatePoseGate,
  RELAX_AFTER_MS,
  gateStatusCopy,
  type OutlineFrame,
  type PoseLandmarkSample,
} from '@/lib/widget/pose-gates';
import {
  INITIAL_GATE_HOLD,
  PoseSmoother,
  stepGateHold,
  type GateHoldState,
} from '@/lib/widget/pose-smoothing';
import {
  captureOnDevicePhoto,
  encodeImageFileToWebp,
  encodeVideoFrameToWebp,
  releaseOnDevicePhoto,
  type OnDevicePhoto,
} from '@/lib/widget/webp-encode';
import type { CaptureSex, CaptureView, PoseGateStatus } from '@/types/hmr';

const ALIGNED_HOLD_MS = 1200;
/**
 * A sharp-enough frame is looked for over this long once the hold completes;
 * the hold is not restarted for one blurred frame. Only then is the shopper told.
 */
const QUALITY_RETRY_MS = 1500;
/** A live photo is kept after this review time unless the shopper taps Retake (they stand far away). */
const AUTO_ACCEPT_MS = 4000;
/** While the pose model loads, the shopper hears this often that it is still coming. */
const LOADING_REMINDER_MS = 12000;

/** Said when each photo step opens: the shopper may already be too far away to read. */
const STEP_INTRO: Record<CaptureView, string> = {
  front:
    'Front photo. Prop your phone up at about waist height, then step back until your whole body, head to feet, '
    + 'fits inside the outline. Keep your arms slightly away from your sides. I will take the photo for you.',
  side:
    'Side photo. Turn to your side, and hold both arms straight out in front of you at shoulder height.',
};
const NOSE = 0;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const POSE_DETECT_INTERVAL_MS = 66;
/** Pose runs on a small copy of the frame; the captured photo stays full size. */
const DETECT_FRAME_LONG_EDGE_PX = 480;
/** The full model is swapped for lite when a detection averages longer than this. */
const SLOW_DETECT_MS = 55;
const SLOW_DETECT_SAMPLES = 20;

/** True when the nose points to the raw frame's right; null while unclear. */
function sideFacingRawRight(pose: readonly PoseLandmarkSample[]): boolean | null {
  const nose = pose[NOSE];
  const left = pose[LEFT_SHOULDER];
  const right = pose[RIGHT_SHOULDER];
  if (!nose || !left || !right || (nose.visibility ?? 0) < 0.5) {
    return null;
  }
  const offset = nose.x - (left.x + right.x) / 2;
  return Math.abs(offset) < 0.02 ? null : offset > 0;
}

function spokenCopy(status: PoseGateStatus, view: CaptureView): string {
  return status === 'aligned' ? 'Hold still' : gateStatusCopy(status, view);
}

interface CaptureViewportProps {
  view: CaptureView;
  /** Picks the female / male / neutral outline. */
  sex: CaptureSex;
  /** The capture's shared pose model (loaded once by GuidedCapture). */
  pose: PoseLandmarkerHandle;
  /**
   * `photo` stays in this browser (a canvas, never uploaded): the shopper's
   * own photo for the try-on result. Live camera captures only.
   */
  onCaptured: (blob: Blob, gate: PoseGateStatus, photo?: OnDevicePhoto | null) => void;
  /** Keep the full camera frame on this device for the try-on result. */
  keepOnDeviceLook?: boolean;
  onBack: () => void;
  allowGallery?: boolean;
  flowStep: Extract<CaptureFlowStep, 'front' | 'side'>;
}

type CaptureSource = 'live' | 'gallery';

interface PendingCapture {
  blob: Blob;
  gate: PoseGateStatus;
  previewUrl: string;
  photo?: OnDevicePhoto | null;
  /** Live captures continue on their own after AUTO_ACCEPT_MS. */
  autoAccept?: boolean;
}

/** A retaken capture's preview URL and on-device frame are dropped at once. */
function discardPending(pending: PendingCapture | null): void {
  if (pending) {
    URL.revokeObjectURL(pending.previewUrl);
    releaseOnDevicePhoto(pending.photo);
  }
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/** The shopper checks the photo (head included, on this device only) before it is used. */
function ReviewPhoto({ pending, view }: { pending: PendingCapture; view: CaptureView }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frame = pending.photo?.frame ?? null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frame) {
      return;
    }
    canvas.width = frame.width;
    canvas.height = frame.height;
    canvas.getContext('2d')?.drawImage(frame, 0, 0);
    return () => {
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [frame]);

  return frame ? (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={`Your ${view} photo`}
      className="absolute inset-0 h-full w-full -scale-x-100 object-contain"
    />
  ) : (
    <div
      role="img"
      aria-label={`${view} pose, head cropped`}
      className="absolute inset-0 bg-contain bg-center bg-no-repeat"
      style={{ backgroundImage: `url(${pending.previewUrl})` }}
    />
  );
}

export function CaptureViewport({
  view,
  sex,
  pose: poseLandmarker,
  onCaptured,
  onBack,
  allowGallery = false,
  flowStep,
  keepOnDeviceLook = false,
}: CaptureViewportProps): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const outlineFrameRef = useRef<OutlineFrame | null>(null);
  const smootherRef = useRef(new PoseSmoother());
  const holdRef = useRef<GateHoldState>(INITIAL_GATE_HOLD);
  const detectCostRef = useRef({ samples: 0, meanMs: 0 });
  const voiceRef = useRef(new CaptureVoice());
  const capturingRef = useRef(false);
  const lastVideoTimeRef = useRef(-1);
  const lastDetectAtRef = useRef(0);
  const lastRawGateRef = useRef<PoseGateStatus>('not_detected');
  /** When this photo's search for the outline began (`RELAX_AFTER_MS`). */
  const searchStartRef = useRef<number | null>(null);
  const lastHoldBucketRef = useRef(-1);
  /** First rejected (dark or blurred) frame of the current hold. */
  const qualityMissSinceRef = useRef<number | null>(null);
  const sourceRef = useRef<CaptureSource>('live');
  const viewportActiveRef = useRef(false);
  const { landmarkerRef, ready, error: poseError, model, fallBackToLite } = poseLandmarker;
  const [viewportActive, setViewportActive] = useState(false);
  const [source, setSource] = useState<CaptureSource>('live');
  const [gate, setGate] = useState<PoseGateStatus>('not_detected');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [encodeError, setEncodeError] = useState<string | null>(null);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const [pending, setPending] = useState<PendingCapture | null>(null);
  const [flash, setFlash] = useState(false);
  const [muted, setMuted] = useState(false);
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [acceptIn, setAcceptIn] = useState<number | null>(null);
  // Side guide faces the way the shopper faces on the (mirrored) preview.
  const [sideGuideMirrored, setSideGuideMirrored] = useState(false);

  sourceRef.current = source;
  viewportActiveRef.current = viewportActive;

  // A capture waiting out its flash; its frame is wiped if we unmount first.
  const pendingDeliveryRef = useRef<{ timer: number; photo: OnDevicePhoto | null } | null>(null);
  useEffect(() => () => {
    const delivery = pendingDeliveryRef.current;
    if (delivery) {
      window.clearTimeout(delivery.timer);
      releaseOnDevicePhoto(delivery.photo);
    }
  }, []);

  useEffect(() => {
    const isMuted = readVoiceMuted();
    voiceRef.current.muted = isMuted;
    setMuted(isMuted);
    setVoiceAvailable(captureVoiceSupported());
    const voice = voiceRef.current;
    return () => voice.stop();
  }, []);

  const toggleMuted = (): void => {
    const next = !muted;
    setMuted(next);
    writeVoiceMuted(next);
    voiceRef.current.muted = next;
    if (next) {
      voiceRef.current.stop();
    } else {
      voiceRef.current.say(spokenCopy(holdRef.current.shown, view), true);
    }
  };

  // The step's instructions, out loud, as soon as it opens (the pose model may still be loading).
  useEffect(() => {
    voiceRef.current.intro(STEP_INTRO[view]);
  }, [view]);

  useEffect(() => {
    if (ready) {
      return;
    }
    const intervalId = window.setInterval(() => {
      voiceRef.current.say('Still getting ready. Stay in front of the camera.');
    }, LOADING_REMINDER_MS);
    return () => window.clearInterval(intervalId);
  }, [ready]);

  const acceptPending = useCallback((capture: PendingCapture): void => {
    voiceRef.current.stop();
    onCaptured(capture.blob, capture.gate, capture.photo);
  }, [onCaptured]);

  // A live photo continues by itself: the shopper is a few metres from the phone.
  useEffect(() => {
    if (!pending?.autoAccept) {
      setAcceptIn(null);
      return;
    }
    const started = Date.now();
    setAcceptIn(Math.ceil(AUTO_ACCEPT_MS / 1000));
    const intervalId = window.setInterval(() => {
      const left = AUTO_ACCEPT_MS - (Date.now() - started);
      if (left <= 0) {
        window.clearInterval(intervalId);
        acceptPending(pending);
        return;
      }
      setAcceptIn(Math.ceil(left / 1000));
    }, 250);
    return () => window.clearInterval(intervalId);
  }, [acceptPending, pending]);

  const handleOutlineFrame = useCallback((frame: OutlineFrame | null) => {
    outlineFrameRef.current = frame;
  }, []);

  const resetHold = useCallback((): void => {
    holdRef.current = INITIAL_GATE_HOLD;
    smootherRef.current.reset();
    lastRawGateRef.current = 'not_detected';
    lastHoldBucketRef.current = -1;
    qualityMissSinceRef.current = null;
    setHoldProgress(0);
    setGate('not_detected');
  }, []);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }
    return subscribeViewportActivity(element, setViewportActive);
  }, []);

  useEffect(() => {
    if (!viewportActive) {
      holdRef.current = { ...holdRef.current, alignedSince: null };
      setHoldProgress(0);
      videoRef.current?.pause();
      return;
    }

    const video = videoRef.current;
    if (source === 'live' && !pending && video?.srcObject) {
      void video.play();
    }
  }, [pending, source, viewportActive]);

  useEffect(() => {
    capturingRef.current = false;
    searchStartRef.current = null;
    lastVideoTimeRef.current = -1;
    lastDetectAtRef.current = 0;
    resetHold();
    setPending((current) => {
      discardPending(current);
      return null;
    });
    setEncodeError(null);
    setGalleryError(null);
    setSource('live');
  }, [resetHold, view]);

  useEffect(() => {
    return () => {
      if (pending) {
        URL.revokeObjectURL(pending.previewUrl);
      }
    };
  }, [pending]);

  useEffect(() => {
    if (source !== 'live' || pending) {
      stopStream(streamRef.current);
      streamRef.current = null;
      return;
    }

    let cancelled = false;

    const startCamera = async (): Promise<void> => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'user' },
            // The try-on is drawn on this frame; pose runs on a small copy.
            width: { ideal: 1920 },
            height: { ideal: 1440 },
          },
        });

        if (cancelled) {
          stopStream(stream);
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          if (viewportActiveRef.current) {
            await video.play();
          }
        }
      } catch {
        if (!cancelled) {
          setCameraError(
            allowGallery
              ? 'Camera access is required to take a photo now. You can import from the gallery instead.'
              : 'Camera access is required. Allow the camera and try again.',
          );
        }
      }
    };

    void startCamera();

    return () => {
      cancelled = true;
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, [allowGallery, pending, source]);

  useEffect(() => {
    let frameId = 0;

    const tick = (): void => {
      frameId = requestAnimationFrame(tick);
      if (
        !viewportActiveRef.current
        || sourceRef.current !== 'live'
        || pending
        || capturingRef.current
      ) {
        return;
      }

      const video = videoRef.current;
      const stage = stageRef.current;
      const landmarker = landmarkerRef.current;
      if (!video || !stage || !landmarker || video.readyState < 2 || video.videoWidth === 0) {
        return;
      }

      if (video.currentTime === lastVideoTimeRef.current) {
        return;
      }

      const now = performance.now();
      if (now - lastDetectAtRef.current < POSE_DETECT_INTERVAL_MS) {
        return;
      }

      lastVideoTimeRef.current = video.currentTime;
      lastDetectAtRef.current = now;

      const detectCanvas = detectCanvasRef.current ?? document.createElement('canvas');
      detectCanvasRef.current = detectCanvas;
      const detectScale = Math.min(1, DETECT_FRAME_LONG_EDGE_PX / Math.max(video.videoWidth, video.videoHeight));
      const detectWidth = Math.round(video.videoWidth * detectScale);
      const detectHeight = Math.round(video.videoHeight * detectScale);
      if (detectCanvas.width !== detectWidth || detectCanvas.height !== detectHeight) {
        detectCanvas.width = detectWidth;
        detectCanvas.height = detectHeight;
      }

      let rawPose: PoseLandmarkSample[] | undefined;
      try {
        detectCanvas.getContext('2d')?.drawImage(video, 0, 0, detectWidth, detectHeight);
        const result = landmarker.detectForVideo(detectCanvas, now);
        rawPose = result.landmarks[0] as PoseLandmarkSample[] | undefined;
      } catch {
        rawPose = undefined;
      }

      const cost = detectCostRef.current;
      const elapsedMs = performance.now() - now;
      cost.samples += 1;
      cost.meanMs += (elapsedMs - cost.meanMs) / Math.min(cost.samples, SLOW_DETECT_SAMPLES);
      if (model === 'full' && cost.samples >= SLOW_DETECT_SAMPLES && cost.meanMs > SLOW_DETECT_MS) {
        cost.samples = 0;
        cost.meanMs = 0;
        fallBackToLite();
      }

      let rawGate: PoseGateStatus = 'not_detected';
      if (rawPose) {
        const { landmarks: smoothed, motion } = smootherRef.current.push(rawPose);
        const box = stage.getBoundingClientRect();
        searchStartRef.current ??= now;
        rawGate = evaluatePoseGate(smoothed, view, lastRawGateRef.current, {
          mapping: {
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            viewWidth: box.width,
            viewHeight: box.height,
            mirrored: true,
          },
          outline: outlineFrameRef.current ?? undefined,
          motion,
          relaxed: now - searchStartRef.current > RELAX_AFTER_MS,
        });
        if (view === 'side') {
          const facing = sideFacingRawRight(smoothed);
          // Raw-right is screen-left on the mirrored preview; the outline faces screen-right.
          if (facing !== null) {
            setSideGuideMirrored(facing);
          }
        }
      } else {
        smootherRef.current.reset();
      }
      lastRawGateRef.current = rawGate;

      const previousShown = holdRef.current.shown;
      const hold = stepGateHold(holdRef.current, rawGate, now);
      holdRef.current = hold;
      if (hold.shown !== previousShown) {
        setGate(hold.shown);
        if (hold.shown === 'aligned') {
          setEncodeError(null);
        }
        voiceRef.current.say(spokenCopy(hold.shown, view), true);
      } else if (hold.shown !== 'aligned') {
        voiceRef.current.say(spokenCopy(hold.shown, view));
      }

      if (hold.shown !== 'aligned' || hold.alignedSince === null) {
        if (lastHoldBucketRef.current !== 0) {
          lastHoldBucketRef.current = 0;
          setHoldProgress(0);
        }
        return;
      }

      const elapsed = now - hold.alignedSince;
      const progress = Math.min(1, elapsed / ALIGNED_HOLD_MS);
      const holdBucket = Math.floor(progress * 30);
      if (holdBucket !== lastHoldBucketRef.current) {
        lastHoldBucketRef.current = holdBucket;
        setHoldProgress(progress);
      }

      // The photo is taken only on a frame that passes on its own, never during a grace miss.
      if (elapsed < ALIGNED_HOLD_MS || rawGate !== 'aligned' || !rawPose) {
        return;
      }

      const pose = rawPose;
      capturingRef.current = true;
      const photo = keepOnDeviceLook
        ? captureOnDevicePhoto(video, pose, video.videoWidth, video.videoHeight)
        : null;
      // A frame too dark or blurred to draw the try-on on: the next aligned frames
      // are tried; only a run of them restarts the hold, with the reason.
      const quality = photo ? assessCanvasQuality(photo.frame) : 'ok';
      if (quality !== 'ok') {
        releaseOnDevicePhoto(photo);
        capturingRef.current = false;
        qualityMissSinceRef.current ??= now;
        if (now - qualityMissSinceRef.current >= QUALITY_RETRY_MS) {
          resetHold();
          setEncodeError(FRAME_QUALITY_COPY[quality]);
          voiceRef.current.announce(FRAME_QUALITY_COPY[quality]);
        }
        return;
      }
      qualityMissSinceRef.current = null;
      void encodeVideoFrameToWebp(video, pose)
        .then((blob) => {
          setHoldProgress(1);
          setFlash(true);
          voiceRef.current.announce(
            view === 'front' ? 'Got it. Stay there for the side photo.' : 'Got it. Building your fitting.',
          );
          const delivery = window.setTimeout(() => {
            pendingDeliveryRef.current = null;
            setFlash(false);
            setPending({
              blob,
              gate: 'aligned',
              previewUrl: URL.createObjectURL(blob),
              photo,
              autoAccept: true,
            });
          }, 420);
          pendingDeliveryRef.current = { timer: delivery, photo };
        })
        .catch(() => {
          releaseOnDevicePhoto(photo);
          capturingRef.current = false;
          resetHold();
          setEncodeError(
            'Head crop failed. Stay aligned so we can remove your face before upload.',
          );
        });
    };

    if (ready && !pending && viewportActive) {
      frameId = requestAnimationFrame(tick);
    }

    return () => cancelAnimationFrame(frameId);
  }, [fallBackToLite, keepOnDeviceLook, landmarkerRef, model, pending, ready, resetHold, view, viewportActive]);

  const title = view === 'front' ? 'Front photo' : 'Side photo';
  const hint =
    view === 'front'
      ? 'Prop your phone up and step back until your head and feet meet the outline, arms slightly open. We take the photo for you.'
      : 'Turn sideways and hold both arms straight out in front of you at shoulder height. Hold still for a moment.';

  const retake = (): void => {
    if (pending) {
      discardPending(pending);
      setPending(null);
    }
    capturingRef.current = false;
    searchStartRef.current = null;
    resetHold();
    setGalleryError(null);
    setEncodeError(null);
    setCameraError(null);
    setSource('live');
  };

  const handleGalleryFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    const landmarker = landmarkerRef.current;
    if (!landmarker) {
      setGalleryError('Pose guidance is still loading. Try again in a moment.');
      return;
    }

    setGalleryBusy(true);
    setGalleryError(null);
    setEncodeError(null);
    capturingRef.current = true;
    sourceRef.current = 'gallery';
    setSource('gallery');

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.src = objectUrl;

    try {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      await image.decode();
      const pose = await detectStillLandmarks(landmarker, image);
      const nextGate = pose
        ? evaluatePoseGate(pose, view, undefined, {
          mapping: {
            videoWidth: image.naturalWidth,
            videoHeight: image.naturalHeight,
            viewWidth: image.naturalWidth,
            viewHeight: image.naturalHeight,
            mirrored: false,
          },
        })
        : 'not_detected';
      setGate(nextGate);
      if (nextGate !== 'aligned' || !pose) {
        setGalleryError(
          `This photo does not pass the ${view} pose check: ${gateStatusCopy(nextGate, view)}.`,
        );
        capturingRef.current = false;
        return;
      }

      const blob = await encodeImageFileToWebp(file, pose);
      discardPending(pending);
      setPending({
        blob,
        gate: 'aligned',
        previewUrl: URL.createObjectURL(blob),
      });
    } catch {
      setGalleryError(
        'Could not verify that photo. Use a full-body shot so we can crop the head on this device.',
      );
      capturingRef.current = false;
    } finally {
      URL.revokeObjectURL(objectUrl);
      setGalleryBusy(false);
    }
  };

  const aligned = gate === 'aligned';

  return (
    <div
      ref={viewportRef}
      className="mx-auto flex h-[100dvh] max-h-[100dvh] w-full max-w-md flex-col bg-ash-canvas text-ash-ink"
    >
      <header className="flex shrink-0 flex-col gap-4 px-6 pt-6">
        <div className="flex h-10 items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-ash-line bg-ash-surface text-ash-ink transition hover:border-ash-subtle active:scale-95"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <h1 className="text-base font-semibold tracking-tight">{title}</h1>
          <span className="h-10 w-10" />
        </div>
        <CaptureFlowMeter step={flowStep} />
        <p className="text-[13px] leading-relaxed text-ash-muted">{hint}</p>
        <ul className="flex flex-col gap-1 text-[12px] leading-snug text-ash-subtle [@media(max-height:760px)]:hidden">
          <li>{CAPTURE_CLOTHING_TIP}</li>
          <li>{CAPTURE_PRIVACY_NOTE}</li>
        </ul>
      </header>

      <div
        ref={stageRef}
        className="relative mx-4 mb-2 mt-4 min-h-[240px] flex-1 overflow-hidden rounded-[28px] bg-[#17151C] shadow-lift"
      >
        {pending ? (
          <ReviewPhoto pending={pending} view={view} />
        ) : (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              className={[
                // Mirrored like a selfie so stepping left moves left on screen.
                // Display only: capture and pose use the raw camera frame.
                'absolute inset-0 h-full w-full -scale-x-100 object-cover',
                source === 'gallery' ? 'invisible' : '',
              ].join(' ')}
            />
            <div aria-hidden="true" className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/45 to-transparent" />
            <SilhouetteOverlay
              view={view}
              sex={sex}
              gate={gate}
              holdProgress={holdProgress}
              mirrored={view === 'side' && sideGuideMirrored}
              onFrame={handleOutlineFrame}
            />
          </>
        )}
        <div
          aria-hidden="true"
          className={[
            'pointer-events-none absolute inset-0 bg-white transition-opacity duration-300',
            flash ? 'opacity-80' : 'opacity-0',
          ].join(' ')}
        />
        <div className="absolute inset-x-0 top-4 flex justify-center px-4">
          <span
            aria-live="polite"
            className="inline-flex max-w-full items-center gap-2.5 rounded-full bg-white/92 px-5 py-2.5 text-[15px] font-semibold leading-snug text-ash-ink shadow-card"
          >
            <span
              aria-hidden="true"
              className={[
                'h-3 w-3 shrink-0 rounded-full transition-colors duration-300',
                aligned || pending ? 'bg-[#22C77A]' : 'bg-[#F0444F]',
              ].join(' ')}
            />
            {pending
              ? acceptIn !== null
                ? 'Got it'
                : 'Check your photo'
              : flash
                ? 'Got it'
                : aligned
                  ? 'Perfect, hold still'
                  : gateStatusCopy(gate, view)}
          </span>
        </div>
        {(cameraError && source === 'live') || encodeError ? (
          <div className="absolute inset-x-0 top-[4.25rem] flex justify-center px-4">
            <p role="alert" className="max-w-full rounded-2xl bg-white/92 px-4 py-2 text-center text-[13px] font-medium leading-snug text-ash-tension shadow-card">
              {encodeError ?? cameraError}
            </p>
          </div>
        ) : null}
        {pending ? (
          <div className="absolute inset-x-0 bottom-0 grid grid-cols-[1fr_1.4fr] gap-3 bg-gradient-to-t from-black/55 to-transparent p-4 pt-10">
            <button type="button" className="ash-cta-secondary py-4" onClick={retake}>
              Retake
            </button>
            <button
              type="button"
              className="ash-cta py-4"
              onClick={() => acceptPending(pending)}
            >
              {acceptIn !== null ? `Use this photo (${acceptIn})` : 'Use this photo'}
            </button>
          </div>
        ) : voiceAvailable ? (
          <button
            type="button"
            onClick={toggleMuted}
            aria-label={muted ? 'Turn spoken guidance on' : 'Mute spoken guidance'}
            aria-pressed={muted}
            className="absolute bottom-4 right-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/92 text-ash-ink shadow-card transition active:scale-95"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                {muted ? (
                  <path d="M16 9.5l5 5M21 9.5l-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                ) : (
                  <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                )}
              </svg>
          </button>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col gap-3 px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
        {galleryError ? <p className="text-sm text-ash-tension">{galleryError}</p> : null}
        {poseError ? (
          <p className="text-[13px] text-ash-muted">
            Pose guidance is required so we can crop your head on this device. Face pixels are
            never uploaded. Refresh and allow the camera to try again.
          </p>
        ) : !ready ? (
          <p className="text-center text-[13px] text-ash-subtle">Loading pose guidance…</p>
        ) : pending ? (
          <p className="text-center text-[13px] text-ash-subtle">
            {acceptIn !== null
              ? 'We keep this photo in a moment. Tap Retake if your whole body isn’t in it. '
              : 'Is your whole body in the picture, standing straight? '}
            This photo stays on your phone; only a copy without your head is uploaded.
          </p>
        ) : (
          <p className="text-center text-[13px] text-ash-subtle">
            The outline turns green when you are in place. Your head is removed on this phone before upload.
          </p>
        )}

        {allowGallery && !pending ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={retake}
              className={[
                'rounded-full border px-3 py-2 text-xs font-semibold transition',
                source === 'live'
                  ? 'border-ash-accent bg-ash-accent-soft text-ash-accent'
                  : 'border-ash-line bg-ash-surface text-ash-muted',
              ].join(' ')}
            >
              Take photo now
            </button>
            <button
              type="button"
              disabled={!ready || galleryBusy}
              onClick={() => fileInputRef.current?.click()}
              className={[
                'rounded-full border px-3 py-2 text-xs font-semibold transition disabled:opacity-50',
                source === 'gallery'
                  ? 'border-ash-accent bg-ash-accent-soft text-ash-accent'
                  : 'border-ash-line bg-ash-surface text-ash-muted',
              ].join(' ')}
            >
              {galleryBusy ? 'Checking pose…' : 'Import from gallery'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => void handleGalleryFile(event)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
