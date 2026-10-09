'use client';

import { useCallback, useEffect, useMemo, useState, type FC } from 'react';

import { AnnyCanvas } from '@/components/vfr/anny-canvas';
import { ConfidenceBadge } from '@/components/vfr/confidence-badge';
import {
  GuidedCapture,
  type GuidedCaptureResult,
} from '@/components/widget/guided-capture/guided-capture';
import { recommendFit } from '@/lib/fit/recommend';
import { releaseOnDevicePhoto } from '@/lib/widget/webp-encode';
import { readFitResiduals } from '@/types/hmr';

export interface WidgetPreviewClientProps {
  tenantId: string;
  embedToken: string;
}

export const WidgetPreviewClient: FC<WidgetPreviewClientProps> = ({
  tenantId,
  embedToken,
}) => {
  const [result, setResult] = useState<GuidedCaptureResult | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [bodySettled, setBodySettled] = useState(false);

  // The GPU job is done: build the avatar behind the still-running loader.
  const handleAvatarReady = useCallback((next: GuidedCaptureResult) => {
    setRevealed(false);
    setBodySettled(false);
    setResult(next);
  }, []);

  // The shopper's camera frames live only as long as this fitting.
  useEffect(() => {
    const photos = result?.photos;
    return () => {
      releaseOnDevicePhoto(photos?.front);
      releaseOnDevicePhoto(photos?.side);
    };
  }, [result]);

  const handleRevealed = useCallback(() => {
    setRevealed(true);
  }, []);

  const recommendation = useMemo(() => {
    if (!result) {
      return null;
    }

    const residuals = readFitResiduals(result.parametric);
    return recommendFit({
      measurements: result.parametric.derived_measurements,
      category: 'tee',
      variants: [],
      captureGatesPassed: result.session.captureGatesPassed,
      ingestTier: null,
      approximateFit: true,
      heightResidualCm: residuals.heightResidualCm,
      clothingResidual: residuals.clothingResidual,
    });
  }, [result]);

  return (
    <main className="relative min-h-screen bg-ash-canvas text-ash-ink">
      {result && recommendation ? (
        <div aria-hidden={!revealed} className="flex min-h-screen flex-col">
          <AnnyCanvas
            parametric={result.parametric}
            heightCm={result.session.heightCm}
            garment={{
              easeCm: recommendation.ease.chestCm,
            }}
            faceImage={result.face}
            revealed={revealed}
            onBodyReady={() => setBodySettled(true)}
            onBodyError={() => setBodySettled(true)}
            className="min-h-[520px] flex-1 w-full"
          />
          <div className="flex items-start justify-between gap-3 px-5 py-4">
            <p className="text-sm text-ash-muted">
              Live Cog body result. Size is girth plus the published chart.
            </p>
            <div className="flex flex-col items-end gap-3">
              <ConfidenceBadge
                sizeCode={recommendation.size.sizeCode}
                gate={recommendation.gate}
              />
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  setRevealed(false);
                }}
                className="rounded-full border border-ash-line px-3 py-1.5 text-xs text-ash-muted"
              >
                Recapture
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {!revealed ? (
        <div className={result ? 'fixed inset-0 z-40 overflow-hidden bg-ash-canvas' : undefined}>
          <GuidedCapture
            tenantId={tenantId}
            embedToken={embedToken}
            allowGallery
            captureFace
            onAvatarReady={handleAvatarReady}
            reveal={result ? (bodySettled ? 'ready' : 'place') : null}
            dressSkipped
            onComplete={handleRevealed}
          />
        </div>
      ) : null}
    </main>
  );
};
