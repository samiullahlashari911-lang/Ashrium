'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { CaptureIntake, type CaptureIntakeValues } from '@/components/widget/guided-capture/capture-intake';
import { CaptureViewport } from '@/components/widget/guided-capture/capture-viewport';
import { AvatarLoading } from '@/components/widget/loading/avatar-loading';
import {
  SHOPPER_AVATAR_WAIT_MS,
  SHOPPER_GPU_TIMEOUT_MESSAGE,
} from '@/lib/ml/session-gpu';
import { watchFitJob } from '@/lib/supabase/fit-job-realtime';
import { CAPTURE_OUTLINES } from '@/lib/widget/capture-outlines';
import {
  releaseOnDevicePhoto,
  releaseOnDevicePhotos,
  type OnDevicePhoto,
  type OnDevicePhotos,
} from '@/lib/widget/webp-encode';
import {
  currentAvatarStage,
  isAvatarStageKey,
  type AvatarRevealStage,
  type AvatarStageKey,
} from '@/lib/widget/avatar-stages';
import {
  abortShopperGpu,
  uploadDualWebpAndDispatch,
  warmShopperGpu,
  type DualUploadProgress,
} from '@/lib/widget/fit-client';
import type {
  FitJobPublicStatus,
  FitParametricVector,
  CaptureSession,
  CaptureView,
  PoseGateStatus,
} from '@/types/hmr';

type CaptureStep = 'intake' | 'front' | 'side' | 'uploading' | 'inferring' | 'error';

function captureErrorTitle(message: string | null): string {
  if (
    message
    && /fitting GPU|2 minutes|finish in time|canceled|could not finish/i.test(message)
  ) {
    return 'Sorry — we could not finish in time';
  }

  return 'Sorry — we could not build your avatar';
}

export interface GuidedCaptureResult {
  session: CaptureSession;
  parametric: FitParametricVector;
  /**
   * Full front/side camera frames for painting the shopper's own look on the
   * avatar. Never uploaded; the owner of this result releases them on close.
   */
  photos: OnDevicePhotos;
}

interface GuidedCaptureProps {
  tenantId: string;
  embedToken: string | null;
  /** Fires after the loader has converged; the avatar is ready to show. */
  onComplete: (result: GuidedCaptureResult) => void;
  /**
   * Fires as soon as the GPU job completes, so the parent can build the 3D
   * avatar behind the loader. When set, the loader holds until `reveal` is
   * `'ready'`.
   */
  onAvatarReady?: (result: GuidedCaptureResult) => void;
  /** Parent's progress building and dressing the avatar after the job completes. */
  reveal?: AvatarRevealStage | null;
  /** No garment landed on the avatar, so "Dressed" is never claimed. */
  dressSkipped?: boolean;
  /** Merchant sandbox / preview only. Live storefront stays camera-only. */
  allowGallery?: boolean;
  /** Keep the full camera frames on this device to paint the shopper's own avatar. */
  keepOnDeviceLook?: boolean;
}

export function GuidedCapture({
  tenantId,
  embedToken,
  onComplete,
  onAvatarReady,
  reveal = null,
  dressSkipped = false,
  allowGallery = false,
  keepOnDeviceLook = false,
}: GuidedCaptureProps): React.JSX.Element {
  const [step, setStep] = useState<CaptureStep>('intake');
  const [intake, setIntake] = useState<CaptureIntakeValues | null>(null);
  const [frontBlob, setFrontBlob] = useState<Blob | null>(null);
  const [frontPhoto, setFrontPhoto] = useState<OnDevicePhoto | null>(null);
  const [sidePhoto, setSidePhoto] = useState<OnDevicePhoto | null>(null);
  const [frontGate, setFrontGate] = useState<PoseGateStatus | null>(null);
  const [sideGate, setSideGate] = useState<PoseGateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [uploadStage, setUploadStage] = useState<DualUploadProgress | null>(null);
  const [warmupError, setWarmupError] = useState<string | null>(null);
  const [gpuArmed, setGpuArmed] = useState(false);
  const [jobStatus, setJobStatus] = useState<FitJobPublicStatus | null>(null);
  const [gpuStage, setGpuStage] = useState<AvatarStageKey | null>(null);
  const [finishedResult, setFinishedResult] = useState<GuidedCaptureResult | null>(null);
  const gpuSessionKeyRef = useRef(
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `gpu-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  );
  const jobIdRef = useRef<string | null>(null);
  const completedRef = useRef(false);
  const onAvatarReadyRef = useRef(onAvatarReady);
  jobIdRef.current = jobId;
  onAvatarReadyRef.current = onAvatarReady;
  const holdsReveal = onAvatarReady !== undefined;

  const stopGpu = useCallback((nextJobId?: string | null) => {
    if (completedRef.current) {
      return;
    }

    void abortShopperGpu(embedToken, {
      jobId: nextJobId ?? jobIdRef.current ?? undefined,
      gpuSessionKey: gpuSessionKeyRef.current,
    });
  }, [embedToken]);

  const failCapture = useCallback((message: string, nextJobId?: string | null) => {
    stopGpu(nextJobId);
    setError(message);
    setStep('error');
  }, [stopGpu]);

  const handleFrontCaptured = useCallback((
    blob: Blob,
    gate: PoseGateStatus,
    photo?: OnDevicePhoto | null,
  ) => {
    setFrontBlob(blob);
    setFrontPhoto(photo ?? null);
    setFrontGate(gate);
    setStep('side');
  }, []);

  const handleSideCaptured = useCallback(
    (blob: Blob, gate: PoseGateStatus, photo?: OnDevicePhoto | null) => {
      if (!intake || !frontBlob) {
        releaseOnDevicePhoto(photo);
        return;
      }

      setSidePhoto(photo ?? null);
      setSideGate(gate);
      setStep('uploading');

      void uploadDualWebpAndDispatch(embedToken, {
        frontBlob,
        sideBlob: blob,
        heightCm: intake.heightCm,
        sex: intake.sex,
        weightKg: intake.weightKg ?? undefined,
        gpuSessionKey: gpuSessionKeyRef.current,
        onProgress: setUploadStage,
      })
        .then((dispatch) => {
          setJobId(dispatch.jobId);
          setStep('inferring');
        })
        .catch((caught: unknown) => {
          failCapture(caught instanceof Error ? caught.message : 'Upload or dispatch failed.');
        });
    },
    [embedToken, failCapture, frontBlob, intake],
  );

  useEffect(() => {
    const warming =
      step === 'front' || step === 'side' || (gpuArmed && step === 'intake');
    if (!warming) {
      return;
    }

    let cancelled = false;
    const run = async (attempt: number): Promise<void> => {
      try {
        await warmShopperGpu(embedToken, gpuSessionKeyRef.current);
        if (!cancelled) {
          setWarmupError(null);
        }
      } catch (caught: unknown) {
        if (cancelled) {
          return;
        }
        if (attempt < 1) {
          await run(attempt + 1);
          return;
        }
        setWarmupError(
          caught instanceof Error
            ? caught.message
            : 'The fitting GPU could not start. You can still take photos — we will retry on submit.',
        );
      }
    };

    void run(0);
    const intervalId = window.setInterval(() => {
      void run(0);
    }, 45_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [embedToken, gpuArmed, step]);

  useEffect(() => {
    if (step !== 'uploading' && step !== 'inferring') {
      setWaitSeconds(0);
      return;
    }

    const started = Date.now();
    const intervalId = window.setInterval(() => {
      setWaitSeconds(Math.floor((Date.now() - started) / 1000));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [step]);

  useEffect(() => {
    if (step !== 'inferring' || !jobId || !intake) {
      return;
    }

    return watchFitJob(
      jobId,
      embedToken,
      (job) => {
        setJobStatus(job.status);
        if (isAvatarStageKey(job.stage)) {
          setGpuStage(job.stage);
        }
        if (job.status === 'completed' && job.parametric_result) {
          if (completedRef.current) {
            return;
          }
          completedRef.current = true;
          const session: CaptureSession = {
            tenantId,
            fitJobId: job.id,
            heightCm: intake.heightCm,
            sex: intake.sex,
            weightKg: intake.weightKg,
            frontImagePath: null,
            sideImagePath: null,
            frontGate,
            sideGate,
            captureGatesPassed: frontGate === 'aligned' && sideGate === 'aligned',
          };
          // Let the particles converge before the avatar reveal takes over.
          const finished = {
            session,
            parametric: job.parametric_result,
            photos: { front: frontPhoto, side: sidePhoto },
          };
          setFinishedResult(finished);
          onAvatarReadyRef.current?.(finished);
          return;
        }

        if (job.status === 'failed') {
          failCapture(job.error_message ?? 'Avatar inference failed.', job.id);
        }
      },
      () => {
        // Status polls can flake while Replicate is still starting the Cog.
        // Keep waiting until the job row is terminal or the wait budget ends.
      },
    );
  }, [
    embedToken,
    failCapture,
    frontGate,
    frontPhoto,
    intake,
    jobId,
    sideGate,
    sidePhoto,
    step,
    tenantId,
  ]);

  useEffect(() => {
    // The GPU budget ends when the job completes; building and dressing the
    // avatar behind the loader is not GPU wait.
    if (step !== 'inferring' || finishedResult) {
      return;
    }

    if (waitSeconds < Math.ceil(SHOPPER_AVATAR_WAIT_MS / 1000)) {
      return;
    }

    failCapture(SHOPPER_GPU_TIMEOUT_MESSAGE);
  }, [failCapture, finishedResult, step, waitSeconds]);

  // Closing Try On before the avatar exists wipes the frames here; after
  // that, the fitting room owns them.
  const unreleasedPhotosRef = useRef({ front: frontPhoto, side: sidePhoto, handedOff: false });
  unreleasedPhotosRef.current = { front: frontPhoto, side: sidePhoto, handedOff: finishedResult !== null };
  useEffect(() => {
    return () => {
      const { front, side, handedOff } = unreleasedPhotosRef.current;
      if (!handedOff) {
        releaseOnDevicePhotos({ front, side });
      }
    };
  }, []);

  useEffect(() => {
    const onPageHide = (): void => {
      stopGpu();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [stopGpu]);

  const reset = (): void => {
    completedRef.current = false;
    stopGpu();
    setStep('intake');
    setIntake(null);
    setFrontBlob(null);
    if (!finishedResult) {
      releaseOnDevicePhotos({ front: frontPhoto, side: sidePhoto });
    }
    setFrontPhoto(null);
    setSidePhoto(null);
    setFrontGate(null);
    setSideGate(null);
    setError(null);
    setJobId(null);
    setWaitSeconds(0);
    setUploadStage(null);
    setWarmupError(null);
    setGpuArmed(false);
    setJobStatus(null);
    setGpuStage(null);
    setFinishedResult(null);
  };

  useEffect(() => {
    if (!warmupError) {
      return;
    }
    // The 45s warm loop keeps retrying; the notice only needs a moment.
    const timeoutId = window.setTimeout(() => setWarmupError(null), 7_000);
    return () => window.clearTimeout(timeoutId);
  }, [warmupError]);

  const warmupBanner = warmupError ? (
    <div
      role="status"
      className="ash-rise fixed inset-x-3 top-3 z-50 mx-auto flex max-w-md items-start gap-3 rounded-2xl border border-ash-line bg-ash-surface/95 px-4 py-3 text-left shadow-lift"
      title={warmupError}
    >
      <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-[13px] font-semibold text-ash-ink">The fitting studio is still starting</p>
        <p className="text-xs leading-relaxed text-ash-muted">
          Keep going. We will try again when you take your photos.
        </p>
      </div>
      <button
        type="button"
        className="shrink-0 rounded-full px-2 py-1 text-xs font-semibold text-ash-accent hover:bg-ash-accent-soft"
        onClick={() => {
          setWarmupError(null);
          void warmShopperGpu(embedToken, gpuSessionKeyRef.current).catch((caught: unknown) => {
            setWarmupError(
              caught instanceof Error ? caught.message : 'The fitting GPU could not start.',
            );
          });
        }}
      >
        Retry
      </button>
    </div>
  ) : null;

  if (step === 'intake') {
    return (
      <div>
        {warmupBanner}
        <CaptureIntake
          showLookNotice={keepOnDeviceLook}
          submitLabel="Next"
          onConsentPassed={() => setGpuArmed(true)}
          onSubmit={(values) => {
            setIntake(values);
            setStep('front');
          }}
        />
      </div>
    );
  }

  if ((step === 'front' || step === 'side') && intake) {
    const view: CaptureView = step;
    return (
      <div>
        {warmupBanner}
        <CaptureViewport
          key={step}
          view={view}
          sex={intake.sex}
          allowGallery={allowGallery}
          keepOnDeviceLook={keepOnDeviceLook}
          flowStep={step}
          onCaptured={step === 'front' ? handleFrontCaptured : handleSideCaptured}
          onBack={() => {
            if (step === 'side') {
              setFrontBlob(null);
              setFrontGate(null);
              releaseOnDevicePhoto(frontPhoto);
              setFrontPhoto(null);
              setStep('front');
              return;
            }

            setStep('intake');
          }}
        />
      </div>
    );
  }

  if (step === 'uploading' || step === 'inferring') {
    const skippedStages = new Set<AvatarStageKey>(
      !holdsReveal ? ['place', 'dress'] : dressSkipped ? ['dress'] : [],
    );
    return (
      <AvatarLoading
        photo={frontBlob}
        outline={intake ? CAPTURE_OUTLINES[intake.sex].front : null}
        stage={currentAvatarStage({
          uploading: step === 'uploading',
          jobStatus: finishedResult ? 'completed' : jobStatus,
          gpuStage,
          reveal: holdsReveal ? reveal ?? 'place' : null,
        })}
        skippedStages={skippedStages}
        elapsedSeconds={waitSeconds}
        finishing={finishedResult !== null && (!holdsReveal || reveal === 'ready')}
        onFinished={() => {
          if (finishedResult) {
            onComplete(finishedResult);
          }
        }}
      />
    );
  }

  return (
    <div className="mx-auto flex h-[100dvh] w-full max-w-md flex-col items-center justify-center gap-5 px-6 text-center text-ash-ink">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-ash-tension-soft text-ash-tension">
        <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
          <path d="M12 8v5M12 16.5v.5M10.3 3.9L2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <h1 className="text-[22px] font-semibold tracking-tight">{captureErrorTitle(error)}</h1>
      <p className="max-w-sm text-sm leading-relaxed text-ash-muted">{error ?? 'Something went wrong.'}</p>
      <p className="max-w-sm text-xs text-ash-subtle">
        Your photos were deleted. Retake them to try again; it only takes a minute.
      </p>
      <button type="button" onClick={reset} className="ash-cta mt-2 px-8 py-4">
        Retake photos
      </button>
    </div>
  );
}
