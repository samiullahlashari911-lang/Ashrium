'use client';

import { useEffect, useRef, useState } from 'react';

import { SilhouetteOverlay } from '@/components/widget/guided-capture/silhouette-overlay';
import { usePoseLandmarker } from '@/components/widget/guided-capture/use-pose-landmarker';
import { evaluatePoseGate, gateStatusCopy, type PoseLandmarkSample } from '@/lib/widget/pose-gates';
import { encodeVideoFrameToWebp } from '@/lib/widget/webp-encode';
import type { CaptureView, PoseGateStatus } from '@/types/hmr';

const ALIGNED_HOLD_MS = 1200;

interface CaptureViewportProps {
  view: CaptureView;
  onCaptured: (blob: Blob, gate: PoseGateStatus) => void;
  onBack: () => void;
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export function CaptureViewport({
  view,
  onCaptured,
  onBack,
}: CaptureViewportProps): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const alignedSinceRef = useRef<number | null>(null);
  const capturingRef = useRef(false);
  const lastVideoTimeRef = useRef(-1);
  const { landmarkerRef, ready, error: poseError } = usePoseLandmarker();
  const [gate, setGate] = useState<PoseGateStatus>('not_detected');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [encodeError, setEncodeError] = useState<string | null>(null);
  const [holdProgress, setHoldProgress] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const startCamera = async (): Promise<void> => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
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
          await video.play();
        }
      } catch {
        if (!cancelled) {
          setCameraError('Camera access is required to capture your photos.');
        }
      }
    };

    void startCamera();

    return () => {
      cancelled = true;
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    let frameId = 0;

    const tick = (): void => {
      frameId = requestAnimationFrame(tick);
      const video = videoRef.current;
      const landmarker = landmarkerRef.current;
      if (!video || !landmarker || video.readyState < 2 || capturingRef.current) {
        return;
      }

      if (video.currentTime === lastVideoTimeRef.current) {
        return;
      }

      lastVideoTimeRef.current = video.currentTime;
      let pose: PoseLandmarkSample[] | undefined;
      try {
        const result = landmarker.detectForVideo(video, performance.now());
        pose = result.landmarks[0] as PoseLandmarkSample[] | undefined;
      } catch {
        setGate('not_detected');
        return;
      }

      const nextGate = pose ? evaluatePoseGate(pose, view) : 'not_detected';
      setGate(nextGate);

      if (nextGate === 'aligned' && pose) {
        const now = performance.now();
        if (alignedSinceRef.current === null) {
          alignedSinceRef.current = now;
          setEncodeError(null);
        }

        const elapsed = now - alignedSinceRef.current;
        setHoldProgress(Math.min(1, elapsed / ALIGNED_HOLD_MS));

        if (elapsed >= ALIGNED_HOLD_MS) {
          capturingRef.current = true;
          void encodeVideoFrameToWebp(video, pose)
            .then((blob) => onCaptured(blob, 'aligned'))
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
        setHoldProgress(0);
      }
    };

    if (ready) {
      frameId = requestAnimationFrame(tick);
    }

    return () => cancelAnimationFrame(frameId);
  }, [landmarkerRef, onCaptured, ready, view]);

  const stepLabel = view === 'front' ? 'Step 2 of 3' : 'Step 3 of 3';
  const title = view === 'front' ? 'Front, A-pose' : 'Side profile';
  const hint =
    view === 'front'
      ? 'Stand in the outline with your arms slightly open. We crop your head on-device before upload.'
      : 'Turn 90° and raise both wrists to your shoulders. We crop your head on-device before upload.';

  return (
    <div className="flex h-full flex-col bg-obsidian-canvas text-obsidian-ink">
      <header className="flex items-start justify-between gap-3 px-5 pt-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-obsidian-subtle">
            {stepLabel}
          </p>
          <h1 className="mt-1 text-xl font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-obsidian-muted">{hint}</p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-obsidian-muted"
        >
          Back
        </button>
      </header>

      <div className="relative mx-5 mt-4 min-h-[360px] flex-1 overflow-hidden rounded-2xl bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute inset-0 h-full w-full object-cover"
        />
        <SilhouetteOverlay view={view} />
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
            {gateStatusCopy(gate, view)}
          </span>
        </div>
        <div className="absolute inset-x-8 bottom-4 h-1 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full bg-gradient-to-r from-obsidian-accent to-obsidian-accent-end transition-[width] duration-100"
            style={{ width: `${Math.round(holdProgress * 100)}%` }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 px-5 py-4">
        {cameraError ? <p className="text-sm text-rose-300">{cameraError}</p> : null}
        {encodeError ? <p className="text-sm text-rose-300">{encodeError}</p> : null}
        {poseError ? (
          <p className="text-sm text-obsidian-muted">
            Pose guidance is required so we can crop your head on this device. Face pixels are
            never uploaded. Refresh and allow the camera to try again.
          </p>
        ) : !ready ? (
          <p className="text-sm text-obsidian-subtle">Loading pose guidance…</p>
        ) : (
          <p className="text-sm text-obsidian-subtle">
            We capture automatically after a 1.2s hold when you are aligned.
          </p>
        )}
      </div>
    </div>
  );
}
