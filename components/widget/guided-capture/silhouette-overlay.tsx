import { useEffect, useMemo, useRef } from 'react';

import { CAPTURE_OUTLINES } from '@/lib/widget/capture-outlines';
import { outlineBodyBounds, outlineFrameInView } from '@/lib/widget/outline-frame';
import type { OutlineFrame } from '@/lib/widget/pose-gates';
import type { CaptureSex, CaptureView, PoseGateStatus } from '@/types/hmr';

interface SilhouetteOverlayProps {
  view: CaptureView;
  sex: CaptureSex;
  gate?: PoseGateStatus;
  /** 0–1 while the aligned pose is held; traces the outline before auto-capture. */
  holdProgress?: number;
  /** Flip left-right so the side guide faces the way the shopper is facing. */
  mirrored?: boolean;
  /** Where the outline's body is drawn, in this overlay's 0-1 coordinates: the pose gate matches against it. */
  onFrame?: (frame: OutlineFrame | null) => void;
  /** The pose model is still loading: nothing is being checked yet, so the outline is neutral. */
  pending?: boolean;
}

const RED = { stroke: '#F0444F', glow: 'rgba(240, 68, 79, 0.55)', fill: 'rgba(240, 68, 79, 0.10)' };
const GREEN = { stroke: '#22C77A', glow: 'rgba(34, 199, 122, 0.7)', fill: 'rgba(34, 199, 122, 0.16)' };
const WAITING = { stroke: 'rgba(255, 255, 255, 0.75)', glow: 'rgba(0, 0, 0, 0.35)', fill: 'rgba(255, 255, 255, 0.06)' };
/** Not aligned is dashed, aligned is solid: the state never rests on red and green alone. */
const DASH_NOT_ALIGNED = '16 11';
const DASH_WAITING = '3 13';

/**
 * Body outline traced from model photos (see gpu/tools/build_outlines.py):
 * one smooth closed path per sex and view, so the guide reads as a real body.
 * Dashed red until the pose gate passes, solid green while aligned (shape and
 * colour both carry it), dotted white while the pose model is still loading;
 * during the hold a bright trace runs around the outline and a 3·2·1 count
 * runs in the middle.
 */
export function SilhouetteOverlay({
  view,
  sex,
  gate = 'not_detected',
  holdProgress = 0,
  mirrored = false,
  onFrame,
  pending = false,
}: SilhouetteOverlayProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const outline = CAPTURE_OUTLINES[sex][view];
  const bounds = useMemo(() => outlineBodyBounds(outline), [outline]);
  const viewBoxWidth = bounds.viewBoxWidth;
  const aligned = gate === 'aligned' && !pending;
  const tone = pending ? WAITING : aligned ? GREEN : RED;
  const traced = Math.max(0, Math.min(1, holdProgress));
  const count = aligned ? Math.max(1, 3 - Math.floor(traced * 3)) : null;

  useEffect(() => {
    const root = rootRef.current;
    const svg = svgRef.current;
    if (!root || !svg || !onFrame) {
      return;
    }
    const measure = (): void => {
      onFrame(outlineFrameInView(bounds, svg.getBoundingClientRect(), root.getBoundingClientRect()));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => {
      observer.disconnect();
      onFrame(null);
    };
  }, [bounds, onFrame]);

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 flex items-center justify-center p-[6%]">
      <svg
        ref={svgRef}
        className="h-[86%] max-w-full overflow-visible"
        viewBox={outline.viewBox}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <g transform={mirrored ? `translate(${viewBoxWidth} 0) scale(-1 1)` : undefined}>
          <path
            d={outline.path}
            fill={tone.fill}
            stroke={tone.stroke}
            strokeWidth={7}
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={pending ? DASH_WAITING : aligned ? undefined : DASH_NOT_ALIGNED}
            style={{
              filter: `drop-shadow(0 0 10px ${tone.glow})`,
              transition: 'fill 280ms ease, stroke 280ms ease, filter 280ms ease',
            }}
          />
          {aligned ? (
            <path
              d={outline.path}
              fill="none"
              stroke="#FFFFFF"
              strokeWidth={9}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={100}
              strokeDasharray="100 100"
              strokeDashoffset={100 - traced * 100}
              style={{
                filter: `drop-shadow(0 0 8px ${GREEN.glow})`,
                transition: 'stroke-dashoffset 90ms linear',
              }}
            />
          ) : null}
        </g>
      </svg>
      {count !== null ? (
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2"
        >
          <span
            key={count}
            className="ash-rise block text-[104px] font-bold leading-none tabular-nums text-white"
            // A dark rim so the count reads against a white shirt from across the room.
            style={{ textShadow: '0 0 3px rgba(0,0,0,0.75), 0 0 1px rgba(0,0,0,0.9), 0 4px 24px rgba(0,0,0,0.5)' }}
          >
            {count}
          </span>
        </span>
      ) : null}
    </div>
  );
}
