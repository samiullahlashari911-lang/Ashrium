'use client';

import { useCallback, useMemo, useState, type FC } from 'react';

import { AnnyCanvas } from '@/components/vfr/anny-canvas';
import { ConfidenceBadge } from '@/components/vfr/confidence-badge';
import {
  GuidedCapture,
  type GuidedCaptureResult,
} from '@/components/widget/guided-capture/guided-capture';
import { recommendFit } from '@/lib/fit/recommend';
import { garmentKindFromCategory } from '@/lib/fit/size-recommend';
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

  const handleComplete = useCallback((next: GuidedCaptureResult) => {
    setResult(next);
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
    <main className="relative min-h-screen bg-obsidian-canvas text-obsidian-ink">
      {result && recommendation ? (
        <div className="flex min-h-screen flex-col">
          <AnnyCanvas
            parametric={result.parametric}
            heightCm={result.session.heightCm}
            garment={{
              kind: garmentKindFromCategory('tee'),
              chestCm: recommendation.size.chestCm,
              waistCm: recommendation.size.waistCm,
              hipCm: recommendation.size.hipCm,
              easeCm: recommendation.ease.chestCm,
            }}
            className="min-h-[520px] flex-1 w-full"
          />
          <div className="flex items-start justify-between gap-3 px-5 py-4">
            <p className="text-sm text-obsidian-muted">
              Live Cog body result. Size is girth plus the published chart.
            </p>
            <div className="flex flex-col items-end gap-3">
              <ConfidenceBadge
                sizeCode={recommendation.size.sizeCode}
                gate={recommendation.gate}
              />
              <button
                type="button"
                onClick={() => setResult(null)}
                className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-obsidian-muted"
              >
                Recapture
              </button>
            </div>
          </div>
        </div>
      ) : (
        <GuidedCapture
          tenantId={tenantId}
          embedToken={embedToken}
          allowGallery
          onComplete={handleComplete}
        />
      )}
    </main>
  );
};
