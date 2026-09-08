'use client';

import { useEffect, useState } from 'react';

import { AnnyCanvas } from '@/components/vfr/anny-canvas';
import { ConfidenceBadge } from '@/components/vfr/confidence-badge';
import { CaptureIntake, type CaptureIntakeValues } from '@/components/widget/guided-capture/capture-intake';
import { recommendFit } from '@/lib/fit/recommend';
import { garmentKindFromCategory } from '@/lib/fit/size-recommend';
import { watchFitJob } from '@/lib/supabase/fit-job-realtime';
import { uploadDualWebpAndDispatch } from '@/lib/widget/fit-client';
import { encodeImageFileToWebp } from '@/lib/widget/webp-encode';
import { readFitResiduals, type FitParametricVector } from '@/types/hmr';

interface DebugGalleryUploadProps {
  tenantId: string;
}

export function DebugGalleryUpload({ tenantId }: DebugGalleryUploadProps): React.JSX.Element {
  const [intake, setIntake] = useState<CaptureIntakeValues | null>(null);
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [sideFile, setSideFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [parametric, setParametric] = useState<FitParametricVector | null>(null);

  useEffect(() => {
    if (!jobId) {
      return;
    }

    return watchFitJob(
      jobId,
      null,
      (job) => {
        if (job.status === 'completed' && job.parametric_result) {
          setParametric(job.parametric_result);
          setBusy(false);
          return;
        }

        if (job.status === 'failed') {
          setError(job.error_message ?? 'Avatar inference failed.');
          setBusy(false);
        }
      },
      (watchError) => {
        setError(watchError.message);
        setBusy(false);
      },
    );
  }, [jobId]);

  const handleSubmit = async (): Promise<void> => {
    if (!intake || !frontFile || !sideFile) {
      setError('Add front and side photos.');
      return;
    }

    setBusy(true);
    setError(null);
    setParametric(null);

    try {
      const [frontBlob, sideBlob] = await Promise.all([
        encodeImageFileToWebp(frontFile),
        encodeImageFileToWebp(sideFile),
      ]);
      const dispatch = await uploadDualWebpAndDispatch(null, {
        frontBlob,
        sideBlob,
        heightCm: intake.heightCm,
        sex: intake.sex,
        weightKg: intake.weightKg ?? undefined,
      });
      setJobId(dispatch.jobId);
    } catch (caught: unknown) {
      setBusy(false);
      setError(caught instanceof Error ? caught.message : 'Debug upload failed.');
    }
  };

  const debugRecommendation = parametric
    ? recommendFit({
        measurements: parametric.derived_measurements,
        category: 'tee',
        variants: [],
        captureGatesPassed: false,
        ingestTier: null,
        approximateFit: true,
        ...readFitResiduals(parametric),
      })
    : null;

  return (
    <section className="rounded-xl border border-dashed border-white/15 bg-obsidian-canvas/40 p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-300">
        Debug only
      </p>
      <h2 className="mt-1 text-lg font-semibold text-obsidian-ink">Gallery upload</h2>
      <p className="mt-1 text-sm text-obsidian-muted">
        Merchant sandbox only. Storefront capture stays live-camera.
      </p>

      {!intake ? (
        <CaptureIntake
          heading="Debug measurements"
          submitLabel="Continue to gallery files"
          showStep={false}
          onSubmit={setIntake}
        />
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-xs text-obsidian-subtle">Tenant {tenantId}</p>
          <label className="flex flex-col gap-2 text-sm text-obsidian-muted">
            Front photo
            <input
              type="file"
              accept="image/*"
              onChange={(event) => setFrontFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-obsidian-muted">
            Side photo
            <input
              type="file"
              accept="image/*"
              onChange={(event) => setSideFile(event.target.files?.[0] ?? null)}
            />
          </label>
          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void handleSubmit();
            }}
            className="obsidian-cta disabled:opacity-50"
          >
            {busy ? 'Running live MHR fit…' : 'Upload and infer'}
          </button>
        </div>
      )}

      {parametric && intake && debugRecommendation ? (
        <div className="mt-5">
          <AnnyCanvas
            parametric={parametric}
            heightCm={intake.heightCm}
            garment={{
              kind: garmentKindFromCategory('tee'),
              chestCm: debugRecommendation.size.chestCm,
              waistCm: debugRecommendation.size.waistCm,
              hipCm: debugRecommendation.size.hipCm,
              easeCm: debugRecommendation.ease.chestCm,
            }}
            className="h-[420px] w-full overflow-hidden rounded-xl"
          />
          <div className="mt-3 flex justify-end">
            <ConfidenceBadge
              sizeCode={debugRecommendation.size.sizeCode}
              gate={debugRecommendation.gate}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
