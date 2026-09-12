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
import { encodeImageFileToWebp, encodeVideoFrameToWebp } from '@/lib/widget/webp-encode';
import type { CaptureView, PoseGateStatus } from '@/types/hmr';

const ALIGNED_HOLD_MS = 1200;
const POSE_DETECT_INTERVAL_MS = 66;

interface CaptureViewportProps {
  view: CaptureView;
  onCaptured: (blob: Blob, gate: PoseGateStatus) => void;
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
  onCaptured,
  onBack,
  allowGallery = false,
  requireConfirm = false,
  flowStep,
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
        const holdBucket = Math.floor(progress * 10);
        if (holdBucket !== lastHoldBucketRef.current) {
          lastHoldBucketRef.current = holdBucket;
          setHoldProgress(progress);
        }

        if (elapsed >= ALIGNED_HOLD_MS) {
          capturingRef.current = true;
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
              setHoldProgress(0);
              onCaptured(blob, 'aligned');
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
  }, [landmarkerRef, onCaptured, pending, ready, requireConfirm, view, viewportActive]);

  const title = view === 'front' ? 'Front, A-pose' : 'Side profile';
  const hint =
    view === 'front'
      ? 'Fit your body inside the outline, arms slightly open. Hold still — we capture automatically.'
      : 'Turn to your side, match the outline, and lift your wrists to the shoulder rings. Hold still to capture.';

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
      className="flex h-[100dvh] max-h-[100dvh] flex-col bg-obsidian-canvas text-obsidian-ink"
    >
      <header className="flex flex-col gap-2 px-5 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CaptureFlowMeter step={flowStep} />
          </div>
          <button
            type="button"
            onClick={onBack}
            className="shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-xs text-obsidian-muted"
          >
            Back
          </button>
        </div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-obsidian-muted">{hint}</p>
      </header>

      <div className="relative mx-5 mt-4 min-h-[360px] flex-1 overflow-hidden rounded-2xl bg-black">
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
                'absolute inset-0 h-full w-full object-cover',
                source === 'gallery' ? 'invisible' : '',
              ].join(' ')}
            />
            <SilhouetteOverlay view={view} gate={gate} />
          </>
        )}
        <div className="absolute left-3 top-3">
          <span
            aria-live="polite"
            className={[
              'rounded-full px-3 py-1 text-xs font-semibold',
              gate === 'aligned'
                ? 'bg-emerald-500 text-obsidian-canvas'
                : 'border border-white/20 bg-obsidian-canvas/70 text-obsidian-ink',
            ].join(' ')}
          >
            {pending ? 'Pose verified' : gateStatusCopy(gate, view)}
          </span>
        </div>
        {!pending ? (
          <div className="absolute inset-x-8 bottom-4 h-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full bg-gradient-to-r from-obsidian-accent to-obsidian-accent-end transition-[width] duration-100"
              style={{ width: `${Math.round(holdProgress * 100)}%` }}
            />
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col gap-3 px-5 py-4">
        {cameraError && source === 'live' ? <p className="text-sm text-rose-300">{cameraError}</p> : null}
        {encodeError ? <p className="text-sm text-rose-300">{encodeError}</p> : null}
        {galleryError ? <p className="text-sm text-rose-300">{galleryError}</p> : null}
        {poseError ? (
          <p className="text-sm text-obsidian-muted">
            Pose guidance is required so we can crop your head on this device. Face pixels are
            never uploaded. Refresh and allow the camera to try again.
          </p>
        ) : !ready ? (
          <p className="text-sm text-obsidian-subtle">Loading pose guidance…</p>
        ) : pending ? (
          <p className="text-sm text-obsidian-subtle">
            {view === 'front'
              ? 'Front pose passed. Tap Next for the side pose.'
              : 'Side pose passed. We will start the live body fit next.'}
          </p>
        ) : (
          <p className="text-sm text-obsidian-subtle">
            We capture automatically after a 1.2s hold when you are aligned.
          </p>
        )}

        {allowGallery && !pending ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={chooseLive}
              className={[
                'rounded-full border px-3 py-2 text-xs font-medium',
                source === 'live'
                  ? 'border-obsidian-accent bg-obsidian-accent/15 text-obsidian-ink'
                  : 'border-white/15 text-obsidian-muted',
              ].join(' ')}
            >
              Take photo now
            </button>
            <button
              type="button"
              disabled={!ready || galleryBusy}
              onClick={() => fileInputRef.current?.click()}
              className={[
                'rounded-full border px-3 py-2 text-xs font-medium disabled:opacity-50',
                source === 'gallery'
                  ? 'border-obsidian-accent bg-obsidian-accent/15 text-obsidian-ink'
                  : 'border-white/15 text-obsidian-muted',
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
            className="obsidian-cta"
            onClick={() => onCaptured(pending.blob, pending.gate)}
          >
            Next
          </button>
        ) : null}
      </div>
    </div>
  );
}
