'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AshriumWordmark } from '@/components/brand/ashrium-logo';
import type { PaintUnavailableReason } from '@/components/vfr/anny-canvas';
import { MirrorView } from '@/components/vfr/mirror-view';
import { ConfidenceBadge } from '@/components/vfr/confidence-badge';
import { approximateReasons } from '@/lib/fit/approximate-reasons';
import { colourwayHex } from '@/lib/graphics/colourway';
import {
  GuidedCapture,
  type GuidedCaptureResult,
} from '@/components/widget/guided-capture/guided-capture';
import { evaluateConfidenceGate } from '@/lib/fit/confidence-gate';
import { sizeRoom, sizeRoomLine } from '@/lib/fit/fit-summary';
import { recommendFit } from '@/lib/fit/recommend';
import {
  fetchFitDrapeResolve,
  fetchFitRecommendation,
  reportTryOnShown,
  type FitRecommendResponse,
  type FitResolveResponse,
} from '@/lib/widget/fit-client';
import { REVEAL_HOLD_MAX_MS, type AvatarRevealStage } from '@/lib/widget/avatar-stages';
import { postWidgetEvent, subscribeToHostEvents } from '@/lib/widget/bridge';
import { releaseOnDevicePhotos } from '@/lib/widget/webp-encode';
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
      fits: payload.size.fits !== false,
      betweenSizeCode: typeof payload.size.between === 'string' ? payload.size.between : null,
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
  // Q9: photos that cannot paint the avatar mean a retake, never the mannequin.
  const [paintFailure, setPaintFailure] = useState<PaintUnavailableReason | null>(null);
  const [captureAttempt, setCaptureAttempt] = useState(0);
  // The photo view confirms the drape is actually drawn before "Size M on you".
  // Kept with the drape it answers for: a reset effect on a new drape ran after
  // the photo view's own draw in the same commit and erased the answer.
  const [shownReport, setShownReport] = useState<{ payload: string | null; shown: boolean } | null>(null);
  const shownPayloadRef = useRef<string | null>(null);
  const handleGarmentShown = useCallback((shown: boolean) => {
    setShownReport({ payload: shownPayloadRef.current, shown });
  }, []);
  // "Try again" on the recommended size re-requests its drape.
  const [drapeAttempt, setDrapeAttempt] = useState(0);

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
    return () => releaseOnDevicePhotos(photos);
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
      garmentName: activeGarment.name,
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
  }, [activeSku, drapeAttempt, embedToken, result]);

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

  // Shopper picked another size: drape that one on the same avatar. The drape
  // is kept by size; it is dropped only if the fitting itself changed (another
  // job or product). Depending on `drapes` here cancelled the request with its
  // own "loading" write, so a picked size never landed.
  const drapesRef = useRef(drapes);
  drapesRef.current = drapes;
  const fittingKey = `${result?.session.fitJobId ?? ''}:${activeSku}`;
  const fittingKeyRef = useRef(fittingKey);
  fittingKeyRef.current = fittingKey;
  const [sizeDrapeAttempt, setSizeDrapeAttempt] = useState(0);
  useEffect(() => {
    const jobId = result?.session.fitJobId;
    if (!jobId || !activeSize || showingRecommended || drapesRef.current[activeSize]) {
      return;
    }
    const requestedFor = `${jobId}:${activeSku}`;
    setDrapes((current) => ({ ...current, [activeSize]: 'loading' }));
    void fetchFitDrapeResolve(embedToken, {
      jobId,
      sku: activeSku,
      allowXpbd: true,
      sizeCode: activeSize,
    })
      .then((drape) => {
        if (fittingKeyRef.current === requestedFor) {
          setDrapes((current) => ({ ...current, [activeSize]: drape }));
        }
      })
      .catch(() => {
        if (fittingKeyRef.current === requestedFor) {
          setDrapes((current) => ({ ...current, [activeSize]: 'failed' }));
        }
      });
  }, [activeSize, activeSku, embedToken, result, showingRecommended, sizeDrapeAttempt]);

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
  shownPayloadRef.current = drapePayloadBase64;
  const garmentShown = shownReport && shownReport.payload === drapePayloadBase64 ? shownReport.shown : null;
  const drawn = garmentShown === true;
  const draping = activeDrapeEntry === 'loading';

  // The job's outcome log: was this size actually drawn on the shopper's photo?
  const fitJobId = result?.session.fitJobId ?? null;
  useEffect(() => {
    if (!fitJobId || !activeSku || garmentShown === null || !drapePayloadBase64) {
      return;
    }
    void reportTryOnShown(embedToken, { jobId: fitJobId, sku: activeSku, sizeCode: activeSize, shown: garmentShown });
  }, [activeSize, activeSku, drapePayloadBase64, embedToken, fitJobId, garmentShown]);

  // How much room the size on screen leaves on this body, from the chart (changes with the size).
  const activeVariant = activeGarment?.sizeVariants.find((variant) => variant.sizeCode === activeSize) ?? null;
  const roomLine = result && activeVariant && recommendation
    ? sizeRoomLine(sizeRoom(activeGarment?.category, activeVariant, result.parametric.derived_measurements, recommendation.ease))
    : null;

  const canvasGarment = recommendation
    ? {
        easeCm: recommendation.ease.chestCm,
        category: activeGarment?.category ?? recommendation.category,
        albedoUrl: printQaPassed ? activeGarment?.albedoUrl ?? null : null,
        printQaPassed,
        colorHex: activeGarment ? colourwayHex(activeGarment.name) : null,
      }
    : null;

  const sizeOptions = activeGarment?.sizeVariants.map((variant) => variant.sizeCode) ?? [];
  const reasons = recommendation && !recommendation.gate.highConfidence
    ? approximateReasons(recommendation.gate, {
      drapeSettled: drapeSettled || holdExpired,
      sizeFits: recommendation.size.fits,
    })
    : [];

  const unavailableReason = typeof activeDrapeEntry === 'object' ? activeDrapeEntry.unavailableReason : null;
  // One clean line instead of a reason list: this size (or every size) is too small.
  const tooTight = unavailableReason === 'too_small' || recommendation?.size.fits === false;

  // Q14: when no garment is on the photo, one clear card says why, with one next step.
  const drapeSettledForSize = activeDrapeEntry !== undefined && activeDrapeEntry !== 'loading';
  const stillDrawing = drapePayloadBase64 !== null && garmentShown === null;
  const sizeIndex = activeSize ? sizeOptions.indexOf(activeSize) : -1;
  const nextLargerSize = sizeIndex >= 0 ? sizeOptions[sizeIndex + 1] ?? null : null;
  const missingGarment: 'size_only' | 'no_fit' | 'too_tight' | 'session_over' | 'not_drawn' | null =
    !revealed || draping || drawn || stillDrawing || (!drapeSettledForSize && !holdExpired)
      ? null
      : !printQaPassed || !activeGarment?.has3d || unavailableReason === 'no_garment'
        ? 'size_only'
        : recommendation?.size.fits === false
          ? 'no_fit'
          : unavailableReason === 'too_small'
            ? 'too_tight'
            // The session's 2-minute GPU window has closed: a retry would fail the same way.
            : unavailableReason === 'gpu_budget'
              ? 'session_over'
              : 'not_drawn';
  const retryDrape = (): void => {
    if (showingRecommended || activeSize === null) {
      setDrapeAttempt((attempt) => attempt + 1);
      return;
    }
    setDrapes((current) => {
      const next = { ...current };
      delete next[activeSize];
      return next;
    });
    setSizeDrapeAttempt((attempt) => attempt + 1);
  };
  const statusChip = !printQaPassed
    ? 'Garment preview is off for this product'
    : draping
      ? `Dressing you in size ${activeSize ?? ''}…`
      : drapePayloadBase64 && drawn
        ? `Size ${activeSize ?? ''} on you`
        : drapePayloadBase64 && garmentShown === false
          ? `Couldn't draw size ${activeSize ?? ''} on you`
        : drapePayloadBase64
          ? `Dressing you in size ${activeSize ?? ''}…`
        : unavailableReason === 'too_small'
          ? `Size ${activeSize ?? ''} doesn’t fit you`
          : activeDrapeEntry === 'failed' || (typeof activeDrapeEntry === 'object' && !drapePayloadBase64) || holdExpired
            ? `Couldn't dress you in size ${activeSize ?? ''}`
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
            <MirrorView
              parametric={result.parametric}
              photos={result.photos}
              garment={canvasGarment}
              drapePayloadBase64={drapePayloadBase64}
              showClearanceHeatmap={showHeatmap && heatmapAvailable}
              revealed={revealed}
              onBodyReady={() => setBodySettled(true)}
              onPrintQaFail={() => setClientPrintQaPassed(false)}
              onPaintUnavailable={setPaintFailure}
              onGarmentShown={handleGarmentShown}
              className="h-[58dvh] min-h-[380px] w-full md:h-full md:min-h-[560px]"
            />
            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-3 p-4 pr-16">
              <AshriumWordmark
                markClassName="h-5 w-5 shrink-0 text-ash-accent"
                wordClassName="text-xs font-semibold tracking-[0.02em] text-ash-ink"
              />
              {missingGarment ? null : <span
                key={statusChip}
                aria-live="polite"
                className="ash-rise inline-flex max-w-[60%] items-center gap-2 rounded-full bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-ash-ink shadow-card"
              >
                {draping ? (
                  <span aria-hidden="true" className="h-3 w-3 animate-spin rounded-full border-2 border-ash-accent/30 border-t-ash-accent" />
                ) : null}
                <span className="truncate">{statusChip}</span>
              </span>}
            </div>
            {missingGarment ? (
              <div
                role="status"
                className="ash-rise absolute inset-x-3 bottom-3 flex flex-col gap-3 rounded-2xl bg-white/95 p-4 shadow-lift md:inset-x-6 md:bottom-6"
              >
                <div className="flex flex-col gap-1">
                  <p className="text-[15px] font-semibold leading-snug text-ash-ink">
                    {missingGarment === 'size_only'
                      ? 'This item is size-only for now'
                      : missingGarment === 'no_fit'
                        ? 'None of this item’s sizes fit you'
                        : missingGarment === 'too_tight'
                          ? `Size ${activeSize ?? ''} doesn’t fit you`
                          : missingGarment === 'session_over'
                            ? `Size ${activeSize ?? ''} can’t be shown now`
                            : `We couldn’t draw size ${activeSize ?? ''} on you`}
                  </p>
                  <p className="text-[13px] leading-relaxed text-ash-muted">
                    {missingGarment === 'size_only'
                      ? 'We can’t show it on you yet. Your size is measured from your body and this item’s size chart.'
                      : missingGarment === 'not_drawn'
                        ? 'Your size is still measured from your body. Try once more.'
                        : missingGarment === 'session_over'
                          ? 'Your fitting session has ended. Retake photos to see another size on you.'
                        : missingGarment === 'too_tight'
                          ? nextLargerSize
                            ? 'Try a larger size.'
                            : 'There’s no larger size of this item. Try another garment.'
                          : 'Close this window to pick another item.'}
                  </p>
                </div>
                {missingGarment === 'too_tight' && nextLargerSize ? (
                  <button
                    type="button"
                    className="ash-cta py-3"
                    onClick={() => {
                      setSelectedSize(nextLargerSize);
                      setAddedSize(null);
                    }}
                  >
                    Try size {nextLargerSize}
                  </button>
                ) : missingGarment === 'not_drawn' ? (
                  <button type="button" className="ash-cta py-3" onClick={retryDrape}>
                    Try again
                  </button>
                ) : null}
              </div>
            ) : null}
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
              {recommendation?.size.betweenSizeCode && !tooTight ? (
                <p className="text-sm font-medium text-ash-ink">
                  You’re between {recommendedSize} and {recommendation.size.betweenSizeCode}.{' '}
                  <span className="font-normal text-ash-muted">
                    {recommendedSize} sits closer to how it’s cut; {recommendation.size.betweenSizeCode} is roomier.
                  </span>
                </p>
              ) : null}
              {tooTight ? (
                <p className="text-sm font-medium text-ash-ink">
                  {recommendation?.size.fits === false
                    ? 'None of the sizes of this product fit you.'
                    : `Size ${activeSize ?? ''} doesn’t fit you.`}{' '}
                  <span className="font-normal text-ash-muted">
                    {recommendation?.size.fits !== false && nextLargerSize
                      ? 'Try a larger size.'
                      : 'Try another garment that fits you.'}
                  </span>
                </p>
              ) : reasons.length > 0 ? (
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
              {roomLine ? (
                <p className="text-sm text-ash-ink">
                  <span className="font-semibold">Size {activeSize}:</span> {roomLine}
                </p>
              ) : null}
              <p className="text-xs text-ash-muted">
                From your measured body and this item’s published size chart.
              </p>
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
      {paintFailure ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ash-canvas p-6">
          <div className="ash-card flex max-w-sm flex-col gap-4 p-6 text-center">
            <h2 className="text-lg font-semibold tracking-tight">Let’s retake your photos</h2>
            <p className="text-sm text-ash-muted">
              {paintFailure === 'face_not_found'
                ? 'We could not see your face clearly enough to put you on your avatar. Face the camera in good light, without anything covering your face.'
                : 'We could not build your avatar from these photos. Stand in good light and hold still while the photo is taken.'}
            </p>
            <button
              type="button"
              className="ash-cta py-4"
              onClick={() => {
                setPaintFailure(null);
                setResult(null);
                setRevealed(false);
                resetFitting();
                setCaptureAttempt((attempt) => attempt + 1);
              }}
            >
              Retake photos
            </button>
          </div>
        </div>
      ) : null}
      {/* Same element before and after the job completes, so the loader keeps
          its particles while it covers the avatar being built underneath. */}
      {!revealed && !paintFailure ? (
        <div className={result ? 'fixed inset-0 z-40 overflow-hidden bg-ash-canvas' : undefined}>
          <GuidedCapture
            key={captureAttempt}
            tenantId={tenantId}
            embedToken={embedToken}
            allowGallery={allowGallery}
            keepOnDeviceLook
            sizeOnly={activeGarment ? !activeGarment.has3d : false}
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
