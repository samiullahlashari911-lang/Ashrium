'use client';

import { useEffect, useRef, useState } from 'react';

import { avatarStageViews, type AvatarStageKey } from '@/lib/widget/avatar-stages';
import type { CaptureOutline } from '@/lib/widget/capture-outlines';

interface AvatarLoadingProps {
  /** The shopper's own headless front photo, still in browser memory. */
  photo: Blob | null;
  /** Front outline the shopper stood in; shapes the particle body. */
  outline?: CaptureOutline | null;
  stage: AvatarStageKey;
  /** Stages that did not happen for this fitting; never listed as done. */
  skippedStages?: ReadonlySet<AvatarStageKey>;
  elapsedSeconds: number;
  /** When true the particles converge, then `onFinished` fires. */
  finishing?: boolean;
  onFinished?: () => void;
}

interface Particle {
  homeX: number;
  homeY: number;
  /** Body-space x (from centre) and depth z; rotated about the vertical axis. */
  bodyX: number;
  bodyZ: number;
  r: number;
  g: number;
  b: number;
  release: number;
  phase: number;
  size: number;
  /** Inside the capture outline: joins the body. Outside: scatters away. */
  inBody: boolean;
  driftX: number;
  driftY: number;
}

/** Same placement as the live capture overlay: 86% tall, centred. */
const OUTLINE_HEIGHT_FRACTION = 0.86;

function outlineHitTest(
  outline: CaptureOutline | null | undefined,
  width: number,
  height: number,
): ((x: number, y: number) => boolean) | null {
  if (!outline || typeof Path2D === 'undefined') {
    return null;
  }
  const [, , boxWidth, boxHeight] = outline.viewBox.split(' ').map(Number);
  if (!boxWidth || !boxHeight) {
    return null;
  }
  const scale = Math.min((height * OUTLINE_HEIGHT_FRACTION) / boxHeight, (width * 0.92) / boxWidth);
  const offsetX = (width - boxWidth * scale) / 2;
  const offsetY = (height - boxHeight * scale) / 2;
  const path = new Path2D(outline.path);
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) {
    return null;
  }
  return (x, y) => probe.isPointInPath(path, (x - offsetX) / scale, (y - offsetY) / scale);
}

const CARD_ASPECT = 4 / 3;
const TARGET_PARTICLES = 4200;
const HOLD_PHOTO_S = 0.5;
const DISSOLVE_S = 1.6;
const SWIRL_SPEED = 0.55;
const FINISH_MS = 700;
const SLOW_START_SECONDS = 60;

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * Loading moment inspired by the owner's reference video: the photo breaks
 * into glitter, the glitter orbits as a rotating body-shaped column while a
 * pill names the real build stage, and it converges when the avatar lands.
 * Canvas 2D only; paused when the tab is hidden; everything is released on
 * unmount.
 */
export function AvatarLoading({
  photo,
  outline = null,
  stage,
  skippedStages,
  elapsedSeconds,
  finishing = false,
  onFinished,
}: AvatarLoadingProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const finishingRef = useRef(finishing);
  const finishedAtRef = useRef<number | null>(null);
  const onFinishedRef = useRef(onFinished);
  finishingRef.current = finishing;
  onFinishedRef.current = onFinished;
  const [reducedMotion] = useState(prefersReducedMotion);

  useEffect(() => {
    if (!finishing || !reducedMotion) {
      return;
    }
    const timeoutId = window.setTimeout(() => onFinishedRef.current?.(), 250);
    return () => window.clearTimeout(timeoutId);
  }, [finishing, reducedMotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !photo) {
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    let disposed = false;
    let frameId: number | null = null;
    let image: HTMLImageElement | null = null;
    let particles: Particle[] = [];
    let startedAt = 0;
    const objectUrl = URL.createObjectURL(photo);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = (): { width: number; height: number } => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      return { width: canvas.width, height: canvas.height };
    };

    const coverRect = (
      source: HTMLImageElement,
      width: number,
      height: number,
    ): { x: number; y: number; w: number; h: number } => {
      const scale = Math.max(width / source.naturalWidth, height / source.naturalHeight);
      const w = source.naturalWidth * scale;
      const h = source.naturalHeight * scale;
      return { x: (width - w) / 2, y: (height - h) / 2, w, h };
    };

    const buildParticles = (source: HTMLImageElement, width: number, height: number): void => {
      const sampler = document.createElement('canvas');
      sampler.width = width;
      sampler.height = height;
      const sampleContext = sampler.getContext('2d', { willReadFrequently: true });
      if (!sampleContext) {
        return;
      }
      const rect = coverRect(source, width, height);
      sampleContext.drawImage(source, rect.x, rect.y, rect.w, rect.h);
      const pixels = sampleContext.getImageData(0, 0, width, height).data;
      const step = Math.max(3, Math.round(Math.sqrt((width * height) / TARGET_PARTICLES)));
      const centreX = width / 2;
      const insideBody = outlineHitTest(outline, width, height);
      const next: Particle[] = [];
      for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
          const offset = (y * width + x) * 4;
          const offsetX = x - centreX;
          const inBody = insideBody ? insideBody(x, y) : true;
          const angle = Math.random() * Math.PI * 2;
          next.push({
            inBody,
            driftX: Math.cos(angle) * (40 + Math.random() * 90) * dpr,
            driftY: (Math.sin(angle) * 60 - 50 - Math.random() * 60) * dpr,
            homeX: x,
            homeY: y,
            bodyX: offsetX,
            bodyZ: 0,
            r: pixels[offset] ?? 0,
            g: pixels[offset + 1] ?? 0,
            b: pixels[offset + 2] ?? 0,
            release: HOLD_PHOTO_S + Math.random() * 0.55 + (1 - y / height) * 0.9,
            phase: Math.random() * Math.PI * 2,
            size: step * (0.42 + Math.random() * 0.35),
          });
        }
      }
      // Give body particles real depth: the torso (the contiguous run through
      // the centre of each row) is an ellipse; arms stay thin. At spin 0 the
      // cloud sits exactly on the photo, then turns as a 3D body.
      const torsoHalfWidth = new Map<number, number>();
      const rows = new Map<number, Particle[]>();
      for (const particle of next) {
        if (particle.inBody) {
          const row = rows.get(particle.homeY) ?? [];
          row.push(particle);
          rows.set(particle.homeY, row);
        }
      }
      rows.forEach((row, rowY) => {
        const occupied = new Set(row.map((particle) => Math.round((particle.homeX - centreX) / step)));
        let reach = 0;
        while (occupied.has(reach + 1) || occupied.has(-(reach + 1))) {
          reach += 1;
        }
        torsoHalfWidth.set(rowY, (reach + 0.5) * step);
      });
      for (const particle of next) {
        if (!particle.inBody) {
          continue;
        }
        const offsetX = particle.homeX - centreX;
        const torso = torsoHalfWidth.get(particle.homeY) ?? 0;
        const depth = Math.abs(offsetX) < torso
          ? Math.sqrt(Math.max(0, torso * torso - offsetX * offsetX)) * 0.75
          : step;
        particle.bodyZ = (Math.random() * 2 - 1) * depth;
      }
      particles = next;
    };

    const draw = (now: number): void => {
      frameId = requestAnimationFrame(draw);
      if (!image) {
        return;
      }
      const t = (now - startedAt) / 1000;
      const { width, height } = canvas;
      context.clearRect(0, 0, width, height);

      const finishT = finishedAtRef.current === null
        ? 0
        : Math.min(1, (now - finishedAtRef.current) / FINISH_MS);
      if (finishingRef.current && finishedAtRef.current === null) {
        finishedAtRef.current = now;
      }

      const photoAlpha = Math.max(0, 1 - Math.max(0, t - HOLD_PHOTO_S) / DISSOLVE_S);
      if (photoAlpha > 0) {
        const rect = coverRect(image, width, height);
        context.globalAlpha = photoAlpha;
        context.drawImage(image, rect.x, rect.y, rect.w, rect.h);
      }

      const centreX = width / 2;
      const centreY = height * 0.52;
      const spin = t * SWIRL_SPEED;
      const tint = Math.min(1, Math.max(0, (t - HOLD_PHOTO_S - DISSOLVE_S) / 3));

      for (const particle of particles) {
        const local = t - particle.release;
        if (local < 0) {
          continue;
        }
        // 0→1 as the particle lifts off the photo and joins the orbit.
        const join = Math.min(1, local / 1.4);
        const eased = join * join * (3 - 2 * join);

        if (!particle.inBody) {
          // Background glitter lifts off and fades out, leaving only the body.
          const fade = 1 - eased;
          if (fade <= 0.02) {
            continue;
          }
          context.globalAlpha = fade * 0.9;
          context.fillStyle = `rgb(${particle.r},${particle.g},${particle.b})`;
          const drift = eased * eased;
          context.fillRect(
            particle.homeX + particle.driftX * drift,
            particle.homeY + particle.driftY * drift,
            particle.size * (1 - eased * 0.5),
            particle.size * (1 - eased * 0.5),
          );
          continue;
        }
        const cosSpin = Math.cos(spin);
        const sinSpin = Math.sin(spin);
        const rotatedX = particle.bodyX * cosSpin + particle.bodyZ * sinSpin;
        const rotatedZ = -particle.bodyX * sinSpin + particle.bodyZ * cosSpin;
        const extent = Math.max(1, Math.abs(particle.bodyX) + Math.abs(particle.bodyZ));
        const depth = Math.max(-1, Math.min(1, rotatedZ / extent));
        const orbitX = centreX + rotatedX;
        const floatY = particle.homeY - Math.sin(t * 0.9 + particle.phase) * 4 * dpr;
        let x = particle.homeX + (orbitX - particle.homeX) * eased;
        let y = particle.homeY + (floatY - particle.homeY) * eased;

        if (finishT > 0) {
          const pull = finishT * finishT;
          x += (centreX - x) * pull;
          y += (centreY - y) * pull * 0.6;
        }

        const twinkle = 0.55 + 0.45 * Math.sin(t * 3.2 + particle.phase * 5);
        const depthAlpha = 0.35 + 0.65 * ((depth + 1) / 2);
        const alpha = Math.min(1, eased * 1.4) * (0.35 + 0.65 * twinkle) * (0.4 + 0.6 * depthAlpha) * (1 - finishT);
        if (alpha <= 0.01) {
          continue;
        }
        // Drift colour toward lavender light as the body "forms".
        const mix = tint * 0.75;
        const r = Math.round(particle.r + (205 - particle.r) * mix);
        const g = Math.round(particle.g + (196 - particle.g) * mix);
        const b = Math.round(particle.b + (255 - particle.b) * mix);
        const size = particle.size * (0.7 + 0.5 * depthAlpha) * (1 + twinkle * 0.25);
        context.globalAlpha = alpha;
        context.fillStyle = `rgb(${r},${g},${b})`;
        context.fillRect(x - size / 2, y - size / 2, size, size);
      }
      context.globalAlpha = 1;

      if (finishT >= 1 && frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
        onFinishedRef.current?.();
      }
    };

    const loaded = new Image();
    loaded.onload = () => {
      if (disposed) {
        return;
      }
      const { width, height } = resize();
      image = loaded;
      buildParticles(loaded, width, height);
      startedAt = performance.now();
      if (!reducedMotion) {
        frameId = requestAnimationFrame(draw);
      } else {
        const rect = coverRect(loaded, width, height);
        context.drawImage(loaded, rect.x, rect.y, rect.w, rect.h);
      }
    };
    loaded.src = objectUrl;

    const onVisibility = (): void => {
      if (document.hidden && frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      } else if (!document.hidden && frameId === null && image && !reducedMotion) {
        frameId = requestAnimationFrame(draw);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      particles = [];
      image = null;
      URL.revokeObjectURL(objectUrl);
    };
  }, [outline, photo, reducedMotion]);

  const views = avatarStageViews(stage, skippedStages);
  const active = views.find((view) => view.state === 'active');
  const done = views.filter((view) => view.state === 'done').slice(-3);
  const slowStart = elapsedSeconds >= SLOW_START_SECONDS && stage === 'gpu';

  return (
    <div className="mx-auto flex h-[100dvh] w-full max-w-md flex-col items-center px-6 pb-8 pt-8 text-ash-ink">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ash-accent">
        Building your avatar
      </p>
      <h1 className="mt-2 text-center text-[24px] font-semibold tracking-tight">
        {stage === 'ready' ? 'Here you are' : 'Hold tight, this is the fun part'}
      </h1>

      <div
        className="relative mt-6 w-full max-w-[300px] overflow-hidden rounded-[28px] bg-[#17151C] shadow-lift"
        style={{ aspectRatio: `${1 / CARD_ASPECT}` }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
        {!photo ? (
          <div className="absolute inset-0 animate-pulse bg-gradient-to-b from-[#221f2b] to-[#17151C]" />
        ) : null}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/50 to-transparent" />
        <div className="absolute inset-x-0 bottom-4 flex justify-center px-4">
          <span
            key={active?.key ?? 'done'}
            role="status"
            aria-live="polite"
            className="ash-rise inline-flex items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-[13px] font-semibold text-ash-ink shadow-card"
          >
            <span aria-hidden="true" className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ash-accent/60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-ash-accent" />
            </span>
            {active?.label ?? 'Your avatar is ready'}
          </span>
        </div>
      </div>

      <ul className="mt-6 flex w-full max-w-[300px] flex-col gap-2" aria-label="Completed steps">
        {done.map((view) => (
          <li key={view.key} className="ash-rise flex items-center gap-2.5 text-[13px] text-ash-muted">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ash-success-soft text-ash-success">
              <svg viewBox="0 0 24 24" className="h-3 w-3" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            {view.label}
          </li>
        ))}
      </ul>

      <div className="mt-auto flex flex-col items-center gap-1 pt-6 text-center">
        <p className="font-mono text-xs tabular-nums text-ash-subtle">{formatElapsed(elapsedSeconds)}</p>
        <p className="max-w-[300px] text-xs leading-relaxed text-ash-subtle">
          {slowStart
            ? 'Starting a fresh GPU. The first fitting of a session takes a little longer.'
            : 'Keep this screen open. Your photos are deleted the moment your avatar is built.'}
        </p>
      </div>
    </div>
  );
}
