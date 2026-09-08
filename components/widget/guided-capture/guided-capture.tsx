'use client';

import { useCallback, useEffect, useState } from 'react';

import { CaptureIntake, type CaptureIntakeValues } from '@/components/widget/guided-capture/capture-intake';
import { CaptureViewport } from '@/components/widget/guided-capture/capture-viewport';
import { watchFitJob } from '@/lib/supabase/fit-job-realtime';
import { uploadDualWebpAndDispatch } from '@/lib/widget/fit-client';
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

  const reset = (): void => {
    setStep('intake');
    setIntake(null);
    setFrontBlob(null);
    setFrontGate(null);
    setSideGate(null);
    setError(null);
    setJobId(null);
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
        stepLabel={step === 'front' ? 'Step 5 of 6' : 'Step 6 of 6'}
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
            : 'The live GPU starts when both photos are submitted. This can take a few minutes on a cold start. Keep this window open — photos are deleted as soon as inference finishes.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 px-6 text-center text-obsidian-ink">
      <h1 className="text-2xl font-semibold">We could not build your avatar</h1>
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
