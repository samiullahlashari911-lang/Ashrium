'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AshriumWordmark } from '@/components/brand/ashrium-logo';
import { AnnyCanvas } from '@/components/vfr/anny-canvas';
import { ConfidenceBadge } from '@/components/vfr/confidence-badge';
import {
  GuidedCapture,
  type GuidedCaptureResult,
} from '@/components/widget/guided-capture/guided-capture';
import { evaluateConfidenceGate } from '@/lib/fit/confidence-gate';
import { recommendFit } from '@/lib/fit/recommend';
import { garmentKindFromCategory } from '@/lib/fit/size-recommend';
import {
  fetchFitDrapeResolve,
  fetchFitRecommendation,
  type FitRecommendResponse,
  type FitResolveResponse,
} from '@/lib/widget/fit-client';
import { postWidgetEvent, subscribeToHostEvents } from '@/lib/widget/bridge';
import type { FitRecommendation, StorefrontGarment } from '@/types/garment';
import { readFitResiduals } from '@/types/hmr';

interface StorefrontViewportProps {
  garments: StorefrontGarment[];
  initialSku: string;
  targetOrigin: string;
  tenantId: string;
  embedToken: string;
  allowGallery?: boolean;
}

function recommendationFromApi(payload: FitRecommendResponse): FitRecommendation {
  return {
    size: {
      sizeCode: payload.size.code,
      source: payload.size.source,
      variantId: payload.size.variantId,
      chestCm: payload.size.chestCm,
      waistCm: payload.size.waistCm,
      hipCm: payload.size.hipCm,
      lengthCm: payload.size.lengthCm,
    },
    gate: {
      highConfidence: payload.gate.highConfidence,
      capturePassed: payload.gate.capturePassed,
      ingestPassed: payload.gate.ingestPassed,
      drapePassed: payload.gate.drapePassed,
      residualPassed: payload.gate.residualPassed,
      printPassed: payload.gate.printPassed !== false,
      hnswSimilarity: payload.gate.hnswSimilarity,
      xpbdCompleted: payload.gate.xpbdCompleted,
    },
    category: payload.category,
    ease: payload.ease,
  };
}

export function StorefrontViewport({
  garments,
  initialSku,
  targetOrigin,
  tenantId,
  embedToken,
  allowGallery = false,
}: StorefrontViewportProps): React.JSX.Element {
  const rootRef = useRef<HTMLElement | null>(null);
  const emittedSizeRef = useRef<string | null>(null);
  const [activeSku, setActiveSku] = useState(
    garments.some((garment) => garment.sku === initialSku) ? initialSku : garments[0]?.sku ?? '',
  );
  const [result, setResult] = useState<GuidedCaptureResult | null>(null);
  const [remoteRecommendation, setRemoteRecommendation] = useState<FitRecommendation | null>(null);
  const [drapeResolve, setDrapeResolve] = useState<FitResolveResponse | null>(null);
  const [clientPrintQaPassed, setClientPrintQaPassed] = useState<boolean | null>(null);

  const activeGarment = garments.find((garment) => garment.sku === activeSku) ?? garments[0] ?? null;

  const handleComplete = useCallback((next: GuidedCaptureResult) => {
    emittedSizeRef.current = null;
    setRemoteRecommendation(null);
    setDrapeResolve(null);
    setClientPrintQaPassed(null);
    setResult(next);
  }, []);

  useEffect(() => {
    return subscribeToHostEvents(targetOrigin, (event) => {
      if (event.type === 'VFR_SET_GARMENT') {
        const exists = garments.some((garment) => garment.sku === event.payload.sku);
        if (exists) {
          setActiveSku(event.payload.sku);
        }
      }
    });
  }, [garments, targetOrigin]);

  useEffect(() => {
    postWidgetEvent(
      { type: 'VFR_WIDGET_READY', payload: { sku: activeSku } },
      targetOrigin,
    );
  }, [activeSku, targetOrigin]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      postWidgetEvent(
        {
          type: 'VFR_RESIZE_VIEWPORT',
          payload: { height: Math.ceil(entry.contentRect.height) },
        },
        targetOrigin,
      );
    });

    observer.observe(root);
    return () => observer.disconnect();
  }, [targetOrigin]);

  const printQaPassed = (activeGarment?.printQaPassed ?? false) && clientPrintQaPassed !== false;

  const localRecommendation = useMemo((): FitRecommendation | null => {
    if (!result || !activeGarment) {
      return null;
    }

    const residuals = readFitResiduals(result.parametric);
    return recommendFit({
      measurements: result.parametric.derived_measurements,
      category: activeGarment.category,
      variants: activeGarment.sizeVariants,
      captureGatesPassed: result.session.captureGatesPassed,
      ingestTier: activeGarment.ingestTier,
      approximateFit: activeGarment.approximateFit || !printQaPassed,
      heightResidualCm: residuals.heightResidualCm,
      clothingResidual: residuals.clothingResidual,
      printQaPassed,
    });
  }, [activeGarment, printQaPassed, result]);

  useEffect(() => {
    if (!result?.session.fitJobId || !activeSku) {
      return;
    }

    let cancelled = false;
    setRemoteRecommendation(null);
    setDrapeResolve(null);
    setClientPrintQaPassed(null);

    void fetchFitRecommendation(embedToken, {
      jobId: result.session.fitJobId,
      sku: activeSku,
      captureGatesPassed: result.session.captureGatesPassed,
    })
      .then((payload) => {
        if (!cancelled) {
          setRemoteRecommendation(recommendationFromApi(payload));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRemoteRecommendation(null);
        }
      });

    void fetchFitDrapeResolve(embedToken, {
      jobId: result.session.fitJobId,
      sku: activeSku,
      allowXpbd: true,
    })
      .then((drape) => {
        if (!cancelled) {
          setDrapeResolve(drape);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDrapeResolve(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeSku, embedToken, result]);

  const recommendation = useMemo((): FitRecommendation | null => {
    const base = remoteRecommendation ?? localRecommendation;
    if (!base || !activeGarment) {
      return base;
    }

    if (!drapeResolve && printQaPassed) {
      return base;
    }

    const residuals = result ? readFitResiduals(result.parametric) : {
      heightResidualCm: null,
      clothingResidual: null,
    };
    const gate = evaluateConfidenceGate({
      captureGatesPassed: base.gate.capturePassed,
      ingestTier: activeGarment.ingestTier,
      approximateFit: activeGarment.approximateFit || !printQaPassed,
      hnswSimilarity: drapeResolve?.similarity ?? base.gate.hnswSimilarity,
      xpbdCompleted: Boolean(drapeResolve?.xpbdCompleted || base.gate.xpbdCompleted),
      heightResidualCm: residuals.heightResidualCm,
      clothingResidual: residuals.clothingResidual,
      printQaPassed,
    });

    return { ...base, gate };
  }, [
    activeGarment,
    drapeResolve,
    localRecommendation,
    printQaPassed,
    remoteRecommendation,
    result,
  ]);

  const drapePayloadBase64 = drapeResolve?.payloadBase64 ?? null;

  useEffect(() => {
    if (!recommendation?.gate.highConfidence) {
      return;
    }

    const emittedKey = `${activeSku}:${recommendation.size.sizeCode}`;
    if (emittedSizeRef.current === emittedKey) {
      return;
    }

    emittedSizeRef.current = emittedKey;
    postWidgetEvent(
      { type: 'VFR_SIZE_RECOMMENDED', payload: { size: recommendation.size.sizeCode } },
      targetOrigin,
    );
  }, [activeSku, recommendation, targetOrigin]);

  const canvasGarment = recommendation
    ? {
        kind: garmentKindFromCategory(activeGarment?.category ?? recommendation.category),
        chestCm: recommendation.size.chestCm,
        waistCm: recommendation.size.waistCm,
        hipCm: recommendation.size.hipCm,
        easeCm: recommendation.ease.chestCm,
        albedoUrl: printQaPassed ? activeGarment?.albedoUrl ?? null : null,
        printQaPassed,
      }
    : null;

  return (
    <main
      ref={rootRef}
      className="relative min-h-[520px] overflow-hidden bg-obsidian-canvas text-obsidian-ink"
    >
      {result ? (
        <div className="flex flex-col">
          <AnnyCanvas
            parametric={result.parametric}
            heightCm={result.session.heightCm}
            garment={canvasGarment}
            drapePayloadBase64={printQaPassed ? drapePayloadBase64 : null}
            onPrintQaFail={() => setClientPrintQaPassed(false)}
            className="h-[min(78vw,640px)] min-h-[420px] w-full"
          />
          <div className="flex items-start justify-between gap-3 px-5 py-4">
            <div>
              <AshriumWordmark
                className="mb-2"
                markClassName="h-5 w-5 shrink-0"
                wordClassName="text-xs font-medium tracking-[0.04em] text-obsidian-ink"
              />
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-obsidian-subtle">
                Your avatar
              </p>
              <p className="mt-1 text-sm text-obsidian-muted">
                Rotate and zoom.
                {!printQaPassed
                  ? ' 3D garment is off until print QA passes. Size is still from girths plus the published chart.'
                  : drapePayloadBase64
                    ? ' Newton drape is on the avatar. Clearance heatmap is a toggle; loose reads blue.'
                    : activeGarment
                      ? ` ${activeGarment.name} size is from girths plus the published chart. Approximate until Newton drape lands.`
                      : ' Size recommendation comes after a confident drape.'}
              </p>
            </div>
            <div className="flex flex-col items-end gap-3">
              <ConfidenceBadge
                sizeCode={recommendation?.size.sizeCode ?? null}
                gate={recommendation?.gate ?? null}
              />
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  setRemoteRecommendation(null);
                  setDrapeResolve(null);
                  setClientPrintQaPassed(null);
                  emittedSizeRef.current = null;
                }}
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
          allowGallery={allowGallery}
          onComplete={handleComplete}
        />
      )}
    </main>
  );
}
