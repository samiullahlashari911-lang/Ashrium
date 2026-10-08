'use client';

import Image from 'next/image';
import { useEffect, useRef, useState, type JSX } from 'react';

import { CAPTURE_OUTLINES } from '@/lib/widget/capture-outlines';

type DemoView = 'front' | 'side';
type DemoPhase = 'adjust' | 'hold' | 'cropped' | 'done';

/**
 * Model photos with the app's male capture outline, which is traced from these
 * same photos (gpu/tools/build_outlines.py prints each transform). The side
 * photo is mirrored so the person faces the same way as the outline. chinY
 * marks the on-device head crop line in photo pixels.
 */
const SHOTS: Record<DemoView, { src: string; width: number; height: number; outline: string; chinY: number }> = {
  front: {
    src: '/marketing/capture-front.webp',
    width: 768,
    height: 1024,
    outline: 'translate(94.7 84.7) scale(0.9195)',
    chinY: 250,
  },
  side: {
    src: '/marketing/capture-side.webp',
    width: 896,
    height: 1200,
    outline: 'translate(300.6 112.6) scale(1.0627)',
    chinY: 294,
  },
};

const RED = { stroke: '#F0444F', glow: 'rgba(240, 68, 79, 0.55)', fill: 'rgba(240, 68, 79, 0.10)' };
const GREEN = { stroke: '#22C77A', glow: 'rgba(34, 199, 122, 0.7)', fill: 'rgba(34, 199, 122, 0.14)' };

interface CaptureFrameProps {
  view: DemoView;
  phase: DemoPhase;
  /** Restart key for the one-shot trace and flash animations. */
  runId?: number;
  /** Sizing: e.g. `aspect-[3/4] w-full`, or `h-full w-full` inside a sized box. */
  className?: string;
  priority?: boolean;
}

/** One capture-camera frame: the model photo, the outline, and the head crop. */
export function CaptureFrame({ view, phase, runId = 0, className = '', priority = false }: CaptureFrameProps): JSX.Element {
  const shot = SHOTS[view];
  const aligned = phase !== 'adjust';
  const tone = aligned ? GREEN : RED;
  const cropped = phase === 'cropped' || phase === 'done';
  // Too close (front) or too far (side) until the shopper steps into place.
  const offset = aligned ? 'scale(1)' : view === 'front' ? 'scale(1.12)' : 'scale(0.86)';

  return (
    <div className={`relative overflow-hidden bg-[#ECE6DF] ${className}`}>
      <div
        className="absolute inset-0 transition-transform duration-500 ease-out"
        style={{ transform: offset, transformOrigin: '50% 55%' }}
      >
        <Image
          src={shot.src}
          alt=""
          fill
          sizes="(min-width: 768px) 240px, 60vw"
          className="object-contain"
          priority={priority}
        />
      </div>
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox={`0 0 ${shot.width} ${shot.height}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        {cropped ? (
          <g>
            <rect x={0} y={0} width={shot.width} height={shot.chinY} fill="#F6F3EE" opacity={0.94} />
            <line
              x1={0}
              x2={shot.width}
              y1={shot.chinY}
              y2={shot.chinY}
              stroke="#6A4CF5"
              strokeWidth={2}
              strokeDasharray="6 6"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ) : null}
        <g transform={shot.outline}>
          <path
            d={CAPTURE_OUTLINES.male[view].path}
            fill={cropped ? 'none' : tone.fill}
            stroke={tone.stroke}
            strokeWidth={2.5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            opacity={cropped ? 0.35 : 1}
            style={{ filter: `drop-shadow(0 0 6px ${tone.glow})`, transition: 'stroke 280ms ease, fill 280ms ease' }}
          />
          {phase === 'hold' ? (
            <path
              key={runId}
              d={CAPTURE_OUTLINES.male[view].path}
              fill="none"
              stroke="#FFFFFF"
              strokeWidth={3.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              pathLength={100}
              strokeDasharray="100 100"
              className="mkt-hold-trace"
              style={{ filter: `drop-shadow(0 0 5px ${GREEN.glow})` }}
            />
          ) : null}
        </g>
      </svg>
      {phase === 'cropped' ? <span key={runId} className="mkt-flash absolute inset-0 bg-white" aria-hidden="true" /> : null}
    </div>
  );
}

const STEPS: { view: DemoView; phase: DemoPhase; ms: number }[] = [
  { view: 'front', phase: 'adjust', ms: 1500 },
  { view: 'front', phase: 'hold', ms: 1200 },
  { view: 'front', phase: 'cropped', ms: 1600 },
  { view: 'side', phase: 'adjust', ms: 1500 },
  { view: 'side', phase: 'hold', ms: 1200 },
  { view: 'side', phase: 'cropped', ms: 1600 },
  { view: 'side', phase: 'done', ms: 2200 },
];

// The app's own gate copy (lib/widget/pose-gates.ts, capture-viewport.tsx).
function statusFor(view: DemoView, phase: DemoPhase): { text: string; dot: string } {
  if (phase === 'adjust') {
    return { text: view === 'front' ? 'Step back a little' : 'Take one step closer', dot: 'bg-[#F0444F]' };
  }
  if (phase === 'hold') {
    return { text: 'Perfect, hold still', dot: 'bg-[#22C77A]' };
  }
  if (phase === 'cropped') {
    return { text: 'Head removed on your phone', dot: 'bg-ash-accent' };
  }
  return { text: '2 photos taken', dot: 'bg-[#22C77A]' };
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * "How it works" capture demo: red outline → green → 1.2 s hold trace →
 * shutter flash → head removed on the phone, front then side. Loops only while
 * on screen and the tab is visible; reduced motion shows a still aligned frame.
 */
export function CaptureDemo(): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(1);
  const [runId, setRunId] = useState(0);
  const [active, setActive] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(prefersReducedMotion());
    const root = rootRef.current;
    if (!root) return undefined;
    let onScreen = false;
    const update = (): void => setActive(onScreen && document.visibilityState === 'visible');
    const observer = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? false;
      update();
    });
    observer.observe(root);
    document.addEventListener('visibilitychange', update);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  useEffect(() => {
    if (!active || reduced) return undefined;
    const timer = window.setTimeout(() => {
      setIndex((current) => (current + 1) % STEPS.length);
      setRunId((current) => current + 1);
    }, STEPS[index].ms);
    return () => window.clearTimeout(timer);
  }, [active, reduced, index]);

  const step = reduced ? STEPS[1] : STEPS[index];
  const status = statusFor(step.view, step.phase);

  return (
    <div ref={rootRef} className="flex h-full items-center justify-center" aria-hidden="true">
      <div className="relative aspect-[3/4] h-full max-w-full overflow-hidden rounded-[22px] border border-ash-line bg-ash-surface shadow-card">
        <CaptureFrame view={step.view} phase={step.phase} runId={runId} className="h-full w-full" />
        <span className="absolute left-1/2 top-2.5 -translate-x-1/2 whitespace-nowrap rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-semibold text-ash-ink shadow-card">
          {step.view === 'front' ? 'Front photo · 1 of 2' : 'Side photo · 2 of 2'}
        </span>
        <span className="absolute bottom-2.5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-semibold text-ash-ink shadow-card">
          <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
          {status.text}
        </span>
      </div>
    </div>
  );
}
