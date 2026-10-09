'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AshriumWordmark } from '@/components/brand/ashrium-logo';
import { AnnyCanvas } from '@/components/vfr/anny-canvas';
import { ConfidenceBadge, approximateReasons } from '@/components/vfr/confidence-badge';
import {
  GuidedCapture,
  type GuidedCaptureResult,
} from '@/components/widget/guided-capture/guided-capture';
import { evaluateConfidenceGate } from '@/lib/fit/confidence-gate';
import { recommendFit } from '@/lib/fit/recommend';
import {
  fetchFitDrapeResolve,
  fetchFitRecommendation,
  type FitRecommendResponse,
  type FitResolveResponse,
} from '@/lib/widget/fit-client';
import { REVEAL_HOLD_MAX_MS, type AvatarRevealStage } from '@/lib/widget/avatar-stages';
import { postWidgetEvent, subscribeToHostEvents } from '@/lib/widget/bridge';
import { releaseOnDevicePhoto } from '@/lib/widget/webp-encode';
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

/** Drape for the recommended size is fetched before its size code is known. */
const RECOMMENDED_DRAPE_KEY = '__recommended__';

type DrapeEntry = FitResolveResponse | 'loading' | 'failed';

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

function drapeReady(entry: DrapeEntry | undefined): entry is FitResolveResponse {
  return typeof entry === 'object' && entry !== null && entry.payloadBase64 !== null;
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
  const [revealed, setRevealed] = useState(false);
  const [bodySettled, setBodySettled] = useState(false);
  const [holdExpired, setHoldExpired] = useState(false);
  const [remoteRecommendation, setRemoteRecommendation] = useState<FitRecommendation | null>(null);
  const [drapes, setDrapes] = useState<Record<string, DrapeEntry>>({});
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [clientPrintQaPassed, setClientPrintQaPassed] = useState<boolean | null>(null);
  const [addedSize, setAddedSize] = useState<string | null>(null);

  const activeGarment = garments.find((garment) => garment.sku === activeSku) ?? garments[0] ?? null;

  const resetFitting = useCallback(() => {
    emittedSizeRef.current = null;
    setRemoteRecommendation(null);
    setDrapes({});
    setSelectedSize(null);
    setShowHeatmap(false);
    setClientPrintQaPassed(null);
    setAddedSize(null);
  }, []);

  // The GPU job is done: build the avatar behind the still-running loader.
  const handleAvatarReady = useCallback((next: GuidedCaptureResult) => {
    resetFitting();
    setRevealed(false);
    setBodySettled(false);
    setHoldExpired(false);
    setResult(next);
  }, [resetFitting]);

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

  useEffect(() => {
    if (!result || revealed) {
      return;
    }
    const timeoutId = window.setTimeout(() => setHoldExpired(true), REVEAL_HOLD_MAX_MS);
    return () => window.clearTimeout(timeoutId);
  }, [result, revealed]);

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
          payload: {
            height: Math.ceil(Math.max(entry.contentRect.height, root.scrollHeight)),
          },
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

  // Recommendation + the recommended size's drape (cache hit or Newton).
  useEffect(() => {
    if (!result?.session.fitJobId || !activeSku) {
      return;
    }

    let cancelled = false;
    setRemoteRecommendation(null);
    setDrapes({ [RECOMMENDED_DRAPE_KEY]: 'loading' });
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
          setDrapes((current) => ({ ...current, [RECOMMENDED_DRAPE_KEY]: drape }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDrapes((current) => ({ ...current, [RECOMMENDED_DRAPE_KEY]: 'failed' }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeSku, embedToken, result]);

  const recommendedDrape = drapes[RECOMMENDED_DRAPE_KEY];

  const recommendation = useMemo((): FitRecommendation | null => {
    const base = remoteRecommendation ?? localRecommendation;
    if (!base || !activeGarment) {
      return base;
    }

    const drape = typeof recommendedDrape === 'object' ? recommendedDrape : null;
    if (!drape && printQaPassed) {
      return base;
    }

    const residuals = result ? readFitResiduals(result.parametric) : {
      heightResidualCm: null,
      clothingResidual: null,
    };
    // Re-evaluated whenever a drape lands, at any wait — no client cutoff.
    const gate = evaluateConfidenceGate({
      captureGatesPassed: base.gate.capturePassed,
      ingestTier: activeGarment.ingestTier,
      approximateFit: activeGarment.approximateFit || !printQaPassed,
      hnswSimilarity: drape?.similarity ?? base.gate.hnswSimilarity,
      xpbdCompleted: Boolean(drape?.xpbdCompleted || base.gate.xpbdCompleted),
      heightResidualCm: residuals.heightResidualCm,
      clothingResidual: residuals.clothingResidual,
      printQaPassed,
    });

    return { ...base, gate };
  }, [activeGarment, localRecommendation, printQaPassed, recommendedDrape, remoteRecommendation, result]);

  const recommendedSize = recommendation?.size.sizeCode ?? null;
  const activeSize = selectedSize ?? recommendedSize;
  const showingRecommended = activeSize !== null && activeSize === recommendedSize;
  const activeDrapeEntry = showingRecommended || activeSize === null
    ? recommendedDrape
    : drapes[activeSize];

  // Shopper picked another size: drape that one on the same avatar.
  useEffect(() => {
    if (!result?.session.fitJobId || !activeSize || showingRecommended || drapes[activeSize]) {
      return;
    }
    let cancelled = false;
    setDrapes((current) => ({ ...current, [activeSize]: 'loading' }));
    void fetchFitDrapeResolve(embedToken, {
      jobId: result.session.fitJobId,
      sku: activeSku,
      allowXpbd: true,
      sizeCode: activeSize,
    })
      .then((drape) => {
        if (!cancelled) {
          setDrapes((current) => ({ ...current, [activeSize]: drape }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDrapes((current) => ({ ...current, [activeSize]: 'failed' }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeSize, activeSku, drapes, embedToken, result, showingRecommended]);

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

  // The loader stays up until the body is rendered and the recommended size
  // has been dressed on (or the drape is known not to be coming).
  const drapeSettled = !printQaPassed
    || !activeSku
    || (recommendedDrape !== undefined && recommendedDrape !== 'loading');
  const revealStage: AvatarRevealStage = holdExpired
    ? 'ready'
    : !bodySettled
      ? 'place'
      : !drapeSettled
        ? 'dress'
        : 'ready';
  const dressSkipped = !drapeReady(recommendedDrape) && (drapeSettled || holdExpired);

  const drapePayloadBase64 = drapeReady(activeDrapeEntry) && printQaPassed
    ? activeDrapeEntry.payloadBase64
    : null;
  const heatmapAvailable = drapePayloadBase64 !== null;
  const draping = activeDrapeEntry === 'loading';

  const canvasGarment = recommendation
    ? {
        easeCm: recommendation.ease.chestCm,
        category: activeGarment?.category ?? recommendation.category,
        albedoUrl: printQaPassed ? activeGarment?.albedoUrl ?? null : null,
        printQaPassed,
      }
    : null;

  const sizeOptions = activeGarment?.sizeVariants.map((variant) => variant.sizeCode) ?? [];
  const reasons = recommendation && !recommendation.gate.highConfidence
    ? approximateReasons(recommendation.gate)
    : [];

  const statusChip = !printQaPassed
    ? 'Showing your body; garment preview is off for this product'
    : draping
      ? `Dressing you in size ${activeSize ?? ''}…`
      : drapePayloadBase64
        ? `Size ${activeSize ?? ''} on your avatar`
        : activeDrapeEntry === 'failed' || (typeof activeDrapeEntry === 'object' && !drapePayloadBase64) || holdExpired
          ? `We couldn't dress you in size ${activeSize ?? ''}. This is you in your own clothes`
          : 'Building your fitting';

  return (
    <main
      ref={rootRef}
      className={
        result
          ? 'relative min-h-[100dvh] overflow-x-hidden bg-ash-canvas text-ash-ink'
          : 'relative h-[100dvh] overflow-hidden bg-ash-canvas text-ash-ink'
      }
    >
      {result ? (
        <div
          aria-hidden={!revealed}
          className="ash-page-in mx-auto grid w-full max-w-5xl gap-4 p-3 md:min-h-[100dvh] md:grid-cols-[minmax(0,1fr)_340px] md:gap-6 md:p-6">
          <section className="relative overflow-hidden rounded-[28px] bg-[radial-gradient(120%_80%_at_50%_15%,#ffffff_0%,#f4f1ec_70%)] shadow-card">
            <AnnyCanvas
              parametric={result.parametric}
              heightCm={result.session.heightCm}
              garment={canvasGarment}
              drapePayloadBase64={drapePayloadBase64}
              showClearanceHeatmap={showHeatmap && heatmapAvailable}
              faceImage={result.face}
              photos={result.photos}
              revealed={revealed}
              onBodyReady={() => setBodySettled(true)}
              onBodyError={() => setBodySettled(true)}
              onPrintQaFail={() => setClientPrintQaPassed(false)}
              className="h-[58dvh] min-h-[380px] w-full md:h-full md:min-h-[560px]"
            />
            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-4">
              <AshriumWordmark
                markClassName="h-5 w-5 shrink-0 text-ash-accent"
                wordClassName="text-xs font-semibold tracking-[0.02em] text-ash-ink"
              />
              <span
                key={statusChip}
                aria-live="polite"
                className="ash-rise inline-flex max-w-[60%] items-center gap-2 rounded-full bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-ash-ink shadow-card"
              >
                {draping ? (
                  <span aria-hidden="true" className="h-3 w-3 animate-spin rounded-full border-2 border-ash-accent/30 border-t-ash-accent" />
                ) : null}
                <span className="truncate">{statusChip}</span>
              </span>
            </div>
            <p className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/70 px-3 py-1 text-[11px] text-ash-muted">
              Drag to turn · pinch to zoom
            </p>
          </section>

          <aside className="ash-card flex flex-col gap-5 p-5 md:self-start">
            <header className="flex flex-col gap-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ash-accent">Your fitting</p>
              <h1 className="text-lg font-semibold leading-snug tracking-tight">
                {activeGarment?.name ?? 'This product'}
              </h1>
            </header>

            <div className="flex flex-col gap-3 rounded-2xl bg-ash-raised p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-ash-muted">Recommended size</p>
                  <p className="mt-1 text-5xl font-semibold leading-none tracking-tight">
                    {recommendedSize ?? '–'}
                  </p>
                </div>
                <ConfidenceBadge sizeCode={recommendedSize} gate={recommendation?.gate ?? null} />
              </div>
              {reasons.length > 0 ? (
                <ul className="flex flex-col gap-1 text-xs text-ash-muted">
                  {reasons.map((reason) => (
                    <li key={reason} className="flex items-center gap-1.5">
                      <span aria-hidden="true" className="h-1 w-1 rounded-full bg-ash-subtle" />
                      {reason}
                    </li>
                  ))}
                </ul>
              ) : recommendation?.gate.highConfidence ? (
                <p className="text-xs text-ash-muted">
                  Measured from your body and this product’s size chart, and confirmed by a cloth simulation.
                </p>
              ) : null}
            </div>

            {sizeOptions.length > 1 ? (
              <div className="flex flex-col gap-2.5">
                <p className="text-xs font-semibold text-ash-ink">Try another size</p>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Size to preview">
                  {sizeOptions.map((code) => {
                    const selected = code === activeSize;
                    const loading = selected && draping;
                    return (
                      <button
                        key={code}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => {
                          setSelectedSize(code);
                          setAddedSize(null);
                        }}
                        className={[
                          'relative min-w-12 rounded-xl border px-3.5 py-2 text-sm font-semibold transition active:scale-95',
                          selected
                            ? 'border-ash-accent bg-ash-accent text-white shadow-cta'
                            : 'border-ash-line bg-ash-surface text-ash-ink hover:border-ash-subtle',
                        ].join(' ')}
                      >
                        {loading ? (
                          <span aria-hidden="true" className="mx-auto block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                        ) : code}
                        {code === recommendedSize ? (
                          <span
                            aria-label="recommended"
                            className={[
                              'absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-white',
                              selected ? 'bg-ash-success' : 'bg-ash-accent',
                            ].join(' ')}
                          />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                {!showingRecommended && recommendedSize ? (
                  <p className="text-xs text-ash-muted">
                    Previewing {activeSize}. We recommend {recommendedSize} for you.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-4 rounded-2xl border border-ash-line p-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold">Fit heatmap</p>
                <p className="text-xs text-ash-muted">
                  {heatmapAvailable
                    ? 'Blue is roomy, red is snug.'
                    : draping || recommendedDrape === 'loading'
                      ? 'Calculating fit…'
                      : 'Available after the cloth simulation.'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={showHeatmap && heatmapAvailable}
                aria-label="Fit heatmap"
                disabled={!heatmapAvailable}
                onClick={() => setShowHeatmap((value) => !value)}
                className={[
                  'relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                  showHeatmap && heatmapAvailable ? 'bg-ash-accent' : 'bg-ash-line',
                ].join(' ')}
              >
                <span
                  aria-hidden="true"
                  className={[
                    'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200',
                    showHeatmap && heatmapAvailable ? 'translate-x-6' : 'translate-x-1',
                  ].join(' ')}
                />
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={!activeSize}
                onClick={() => {
                  if (!activeSize) {
                    return;
                  }
                  setAddedSize(activeSize);
                  postWidgetEvent(
                    { type: 'VFR_ADD_TO_CART', payload: { size: activeSize } },
                    targetOrigin,
                  );
                }}
                className="ash-cta w-full py-4"
              >
                {addedSize && addedSize === activeSize
                  ? `Size ${activeSize} added`
                  : `Add size ${activeSize ?? ''} to cart`}
              </button>
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  setRevealed(false);
                  resetFitting();
                }}
                className="rounded-xl py-2 text-sm font-semibold text-ash-muted transition hover:text-ash-ink"
              >
                Retake photos
              </button>
            </div>

            <p className="text-center text-[11px] leading-relaxed text-ash-subtle">
              Your photos were deleted as soon as your avatar was built.
            </p>
          </aside>
        </div>
      ) : null}
      {/* Same element before and after the job completes, so the loader keeps
          its particles while it covers the avatar being built underneath. */}
      {!revealed ? (
        <div className={result ? 'fixed inset-0 z-40 overflow-hidden bg-ash-canvas' : undefined}>
          <GuidedCapture
            tenantId={tenantId}
            embedToken={embedToken}
            allowGallery={allowGallery}
            captureFace
            onAvatarReady={handleAvatarReady}
            reveal={result ? revealStage : null}
            dressSkipped={dressSkipped}
            onComplete={handleRevealed}
          />
        </div>
      ) : null}
    </main>
  );
}
