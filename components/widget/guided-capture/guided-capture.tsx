'use client';

import { useCallback, useEffect, useState } from 'react';

import { CaptureIntake, type CaptureIntakeValues } from '@/components/widget/guided-capture/capture-intake';
import { CaptureViewport } from '@/components/widget/guided-capture/capture-viewport';
import {
  SHOPPER_GPU_TIMEOUT_MESSAGE,
  SHOPPER_INFERENCE_DEADLINE_MS,
} from '@/lib/ml/session-gpu';
import { watchFitJob } from '@/lib/supabase/fit-job-realtime';
import { uploadDualWebpAndDispatch, warmShopperGpu } from '@/lib/widget/fit-client';
import type {
  FitParametricVector,
  CaptureSession,
  CaptureView,
  PoseGateStatus,
} from '@/types/hmr';

type CaptureStep = 'intake' | 'front' | 'side' | 'uploading' | 'inferring' | 'error';

export interface GuidedCaptureResult {
  session: CaptureSession;
  parametric: FitParametricVector;
}

interface GuidedCaptureProps {
  tenantId: string;
  embedToken: string | null;
  onComplete: (result: GuidedCaptureResult) => void;
  /** Merchant sandbox / preview only. Live storefront stays camera-only. */
  allowGallery?: boolean;
}

export function GuidedCapture({
  tenantId,
  embedToken,
  onComplete,
  allowGallery = false,
}: GuidedCaptureProps): React.JSX.Element {
  const [step, setStep] = useState<CaptureStep>('intake');
  const [intake, setIntake] = useState<CaptureIntakeValues | null>(null);
  const [frontBlob, setFrontBlob] = useState<Blob | null>(null);
  const [frontGate, setFrontGate] = useState<PoseGateStatus | null>(null);
  const [sideGate, setSideGate] = useState<PoseGateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [waitSeconds, setWaitSeconds] = useState(0);

  const handleFrontCaptured = useCallback((blob: Blob, gate: PoseGateStatus) => {
    setFrontBlob(blob);
    setFrontGate(gate);
    setStep('side');
  }, []);

  const handleSideCaptured = useCallback(
    (blob: Blob, gate: PoseGateStatus) => {
      if (!intake || !frontBlob) {
        return;
      }

      setSideGate(gate);
      setStep('uploading');

      void uploadDualWebpAndDispatch(embedToken, {
        frontBlob,
        sideBlob: blob,
        heightCm: intake.heightCm,
        sex: intake.sex,
        weightKg: intake.weightKg ?? undefined,
      })
        .then((dispatch) => {
          setJobId(dispatch.jobId);
          setStep('inferring');
        })
        .catch((caught: unknown) => {
          setError(caught instanceof Error ? caught.message : 'Upload or dispatch failed.');
          setStep('error');
        });
    },
    [embedToken, frontBlob, intake],
  );

  useEffect(() => {
    if (step !== 'front' && step !== 'side') {
      return;
    }

    void warmShopperGpu(embedToken);
  }, [embedToken, step]);

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
        if (job.status === 'completed' && job.parametric_result) {
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
          onComplete({ session, parametric: job.parametric_result });
          return;
        }

        if (job.status === 'failed') {
          setError(job.error_message ?? 'Avatar inference failed.');
          setStep('error');
        }
      },
      (watchError) => {
        setError(watchError.message);
        setStep('error');
      },
    );
  }, [embedToken, frontGate, intake, jobId, onComplete, sideGate, step, tenantId]);

  useEffect(() => {
    if (step !== 'inferring') {
      return;
    }

    if (waitSeconds < Math.ceil(SHOPPER_INFERENCE_DEADLINE_MS / 1000)) {
      return;
    }

    setError(SHOPPER_GPU_TIMEOUT_MESSAGE);
    setStep('error');
  }, [step, waitSeconds]);

  const reset = (): void => {
    setStep('intake');
    setIntake(null);
    setFrontBlob(null);
    setFrontGate(null);
    setSideGate(null);
    setError(null);
    setJobId(null);
    setWaitSeconds(0);
  };

  if (step === 'intake') {
    return (
      <CaptureIntake
        submitLabel="Next"
        onSubmit={(values) => {
          setIntake(values);
          setStep('front');
        }}
      />
    );
  }

  if ((step === 'front' || step === 'side') && intake) {
    const view: CaptureView = step;
    return (
      <CaptureViewport
        view={view}
        allowGallery={allowGallery}
        flowStep={step}
        onCaptured={step === 'front' ? handleFrontCaptured : handleSideCaptured}
        onBack={() => {
          if (step === 'side') {
            setFrontBlob(null);
            setFrontGate(null);
            setStep('front');
            return;
          }

          setStep('intake');
        }}
      />
    );
  }

  if (step === 'uploading' || step === 'inferring') {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 px-6 text-center text-obsidian-ink">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-obsidian-subtle">
          Building your avatar
        </p>
        <h1 className="text-2xl font-semibold">
          {step === 'uploading' ? 'Uploading photos' : 'Running live MHR fit'}
        </h1>
        <p className="max-w-sm text-sm text-obsidian-muted">
          {step === 'uploading'
            ? 'Photos are deleted as soon as inference finishes.'
            : 'The GPU started while you were taking photos so the body fit can finish in 2 minutes. We stop it if the avatar is not ready by then.'}
        </p>
        <p className="font-mono text-xs text-obsidian-subtle">
          {step === 'inferring'
            ? `${waitSeconds}s elapsed · ${Math.max(0, 120 - waitSeconds)}s remaining`
            : `${waitSeconds}s elapsed`}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 px-6 text-center text-obsidian-ink">
      <h1 className="text-2xl font-semibold">Sorry — we could not finish in time</h1>
      <p className="max-w-sm text-sm text-rose-300">{error ?? 'Something went wrong.'}</p>
      <button
        type="button"
        onClick={reset}
        className="obsidian-cta"
      >
        Try again
      </button>
    </div>
  );
}
