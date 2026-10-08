'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';

import { CaptureFlowMeter } from '@/components/widget/guided-capture/capture-flow-meter';
import { SilhouetteOverlay } from '@/components/widget/guided-capture/silhouette-overlay';
import {
  detectStillLandmarks,
  usePoseLandmarker,
} from '@/components/widget/guided-capture/use-pose-landmarker';
import { subscribeViewportActivity } from '@/lib/graphics/viewport-activity';
import type { CaptureFlowStep } from '@/lib/widget/capture-progress';
import { evaluatePoseGate, gateStatusCopy, type PoseLandmarkSample } from '@/lib/widget/pose-gates';
import {
  cropOnDeviceFace,
  encodeImageFileToWebp,
  encodeVideoFrameToWebp,
  type OnDeviceFace,
} from '@/lib/widget/webp-encode';
import type { CaptureSex, CaptureView, PoseGateStatus } from '@/types/hmr';

const ALIGNED_HOLD_MS = 1200;
const NOSE = 0;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;

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
const POSE_DETECT_INTERVAL_MS = 66;

interface CaptureViewportProps {
  view: CaptureView;
  /** Picks the female / male / neutral outline. */
  sex: CaptureSex;
  /** `face` is only set when the merchant enabled the on-device face; it never leaves the browser. */
  onCaptured: (blob: Blob, gate: PoseGateStatus, face?: OnDeviceFace | null) => void;
  /** Keep an on-device face crop from the front photo (merchant opt-in). */
  captureFace?: boolean;
  onBack: () => void;
  allowGallery?: boolean;
  requireConfirm?: boolean;
  flowStep: Extract<CaptureFlowStep, 'front' | 'side'>;
}

type CaptureSource = 'live' | 'gallery';

interface PendingCapture {
  blob: Blob;
  gate: PoseGateStatus;
  previewUrl: string;
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export function CaptureViewport({
  view,
  sex,
  onCaptured,
  onBack,
  allowGallery = false,
  requireConfirm = false,
  flowStep,
  captureFace = false,
}: CaptureViewportProps): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const alignedSinceRef = useRef<number | null>(null);
  const capturingRef = useRef(false);
  const lastVideoTimeRef = useRef(-1);
  const lastDetectAtRef = useRef(0);
  const lastGateRef = useRef<PoseGateStatus>('not_detected');
  const lastHoldBucketRef = useRef(-1);
  const sourceRef = useRef<CaptureSource>('live');
  const viewportActiveRef = useRef(false);
  const { landmarkerRef, ready, error: poseError } = usePoseLandmarker();
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
  // Side guide faces the way the shopper faces on the (mirrored) preview.
  const [sideGuideMirrored, setSideGuideMirrored] = useState(false);

  sourceRef.current = source;
  viewportActiveRef.current = viewportActive;

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }
    return subscribeViewportActivity(element, setViewportActive);
  }, []);

  useEffect(() => {
    if (!viewportActive) {
      alignedSinceRef.current = null;
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
    alignedSinceRef.current = null;
    lastVideoTimeRef.current = -1;
    lastDetectAtRef.current = 0;
    lastGateRef.current = 'not_detected';
    lastHoldBucketRef.current = -1;
    setHoldProgress(0);
    setPending((current) => {
      if (current) {
        URL.revokeObjectURL(current.previewUrl);
      }
      return null;
    });
    setEncodeError(null);
    setGalleryError(null);
    setGate('not_detected');
    setSource('live');
  }, [view]);

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
            width: { ideal: 960 },
            height: { ideal: 720 },
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
      const landmarker = landmarkerRef.current;
      if (!video || !landmarker || video.readyState < 2) {
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

      let pose: PoseLandmarkSample[] | undefined;
      try {
        const result = landmarker.detectForVideo(video, now);
        pose = result.landmarks[0] as PoseLandmarkSample[] | undefined;
      } catch {
        if (lastGateRef.current !== 'not_detected') {
          lastGateRef.current = 'not_detected';
          setGate('not_detected');
        }
        return;
      }

      const nextGate = pose ? evaluatePoseGate(pose, view, lastGateRef.current) : 'not_detected';
      if (view === 'side' && pose) {
        const facing = sideFacingRawRight(pose);
        // Raw-right is screen-left on the mirrored preview; the outline faces screen-right.
        if (facing !== null) {
          setSideGuideMirrored(facing);
        }
      }
      if (nextGate !== lastGateRef.current) {
        lastGateRef.current = nextGate;
        setGate(nextGate);
      }

      if (nextGate === 'aligned' && pose) {
        if (alignedSinceRef.current === null) {
          alignedSinceRef.current = now;
          setEncodeError(null);
        }

        const elapsed = now - alignedSinceRef.current;
        const progress = Math.min(1, elapsed / ALIGNED_HOLD_MS);
        const holdBucket = Math.floor(progress * 30);
        if (holdBucket !== lastHoldBucketRef.current) {
          lastHoldBucketRef.current = holdBucket;
          setHoldProgress(progress);
        }

        if (elapsed >= ALIGNED_HOLD_MS) {
          capturingRef.current = true;
          const face = captureFace && view === 'front'
            ? cropOnDeviceFace(video, pose, video.videoWidth, video.videoHeight)
            : null;
          void encodeVideoFrameToWebp(video, pose)
            .then((blob) => {
              if (requireConfirm) {
                setPending({
                  blob,
                  gate: 'aligned',
                  previewUrl: URL.createObjectURL(blob),
                });
                stopStream(streamRef.current);
                streamRef.current = null;
                return;
              }

              capturingRef.current = true;
              alignedSinceRef.current = null;
              setHoldProgress(1);
              setFlash(true);
              window.setTimeout(() => onCaptured(blob, 'aligned', face), 420);
            })
            .catch(() => {
              capturingRef.current = false;
              alignedSinceRef.current = null;
              setHoldProgress(0);
              setEncodeError(
                'Head crop failed. Stay aligned so we can remove your face before upload.',
              );
            });
        }
      } else {
        alignedSinceRef.current = null;
        if (lastHoldBucketRef.current !== 0) {
          lastHoldBucketRef.current = 0;
          setHoldProgress(0);
        }
      }
    };

    if (ready && !pending && viewportActive) {
      frameId = requestAnimationFrame(tick);
    }

    return () => cancelAnimationFrame(frameId);
  }, [captureFace, landmarkerRef, onCaptured, pending, ready, requireConfirm, view, viewportActive]);

  const title = view === 'front' ? 'Front photo' : 'Side photo';
  const hint =
    view === 'front'
      ? 'Prop your phone up, step back until your whole body fits the outline, arms slightly open. We take the photo for you.'
      : 'Turn sideways and hold both arms straight out in front of you at shoulder height. Hold still for a moment.';

  const chooseLive = (): void => {
    if (pending) {
      URL.revokeObjectURL(pending.previewUrl);
      setPending(null);
    }
    capturingRef.current = false;
    alignedSinceRef.current = null;
    setHoldProgress(0);
    setGalleryError(null);
    setEncodeError(null);
    setCameraError(null);
    setGate('not_detected');
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
      const nextGate = pose ? evaluatePoseGate(pose, view) : 'not_detected';
      setGate(nextGate);
      if (nextGate !== 'aligned' || !pose) {
        setGalleryError(
          `This photo does not pass the ${view} pose check: ${gateStatusCopy(nextGate, view)}.`,
        );
        capturingRef.current = false;
        return;
      }

      const blob = await encodeImageFileToWebp(file, pose);
      if (requireConfirm) {
        if (pending) {
          URL.revokeObjectURL(pending.previewUrl);
        }
        setPending({
          blob,
          gate: 'aligned',
          previewUrl: URL.createObjectURL(blob),
        });
        return;
      }

      capturingRef.current = false;
      onCaptured(blob, 'aligned');
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
      </header>

      <div className="relative mx-4 mb-2 mt-4 min-h-[360px] flex-1 overflow-hidden rounded-[28px] bg-[#17151C] shadow-lift">
        {pending ? (
          <div
            role="img"
            aria-label={`${view} pose, head cropped`}
            className="absolute inset-0 bg-contain bg-center bg-no-repeat"
            style={{ backgroundImage: `url(${pending.previewUrl})` }}
          />
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
            className="inline-flex items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-[13px] font-semibold text-ash-ink shadow-card"
          >
            <span
              aria-hidden="true"
              className={[
                'h-2.5 w-2.5 rounded-full transition-colors',
                gate === 'aligned' || pending ? 'bg-[#22C77A]' : 'bg-[#F0444F]',
              ].join(' ')}
            />
            {pending
              ? 'Pose verified'
              : flash
                ? 'Got it'
                : gate === 'aligned'
                  ? 'Perfect, hold still'
                  : gateStatusCopy(gate, view)}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-3 px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
        {cameraError && source === 'live' ? <p className="text-sm text-ash-tension">{cameraError}</p> : null}
        {encodeError ? <p className="text-sm text-ash-tension">{encodeError}</p> : null}
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
            {view === 'front'
              ? 'Front pose passed. Tap Next for the side pose.'
              : 'Side pose passed. We will build your avatar next.'}
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
              onClick={chooseLive}
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

        {pending && requireConfirm ? (
          <button
            type="button"
            className="ash-cta py-4"
            onClick={() => onCaptured(pending.blob, pending.gate)}
          >
            Next
          </button>
        ) : null}
      </div>
    </div>
  );
}
