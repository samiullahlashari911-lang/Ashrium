import { CAPTURE_OUTLINES } from '@/lib/widget/capture-outlines';
import type { CaptureSex, CaptureView, PoseGateStatus } from '@/types/hmr';

interface SilhouetteOverlayProps {
  view: CaptureView;
  sex: CaptureSex;
  gate?: PoseGateStatus;
  /** 0–1 while the aligned pose is held; traces the outline before auto-capture. */
  holdProgress?: number;
  /** Flip left-right so the side guide faces the way the shopper is facing. */
  mirrored?: boolean;
}

const RED = { stroke: '#F0444F', glow: 'rgba(240, 68, 79, 0.55)', fill: 'rgba(240, 68, 79, 0.10)' };
const GREEN = { stroke: '#22C77A', glow: 'rgba(34, 199, 122, 0.7)', fill: 'rgba(34, 199, 122, 0.16)' };

/**
 * Body outline generated from the Meta MHR mean mesh (see
 * gpu/tools/build_outlines.py): one smooth closed path per sex and view, so
 * the guide reads as a real body, not joined strokes. Red until the pose
 * gate passes, green while aligned, and a bright trace runs around the
 * outline during the hold.
 */
export function SilhouetteOverlay({
  view,
  sex,
  gate = 'not_detected',
  holdProgress = 0,
  mirrored = false,
}: SilhouetteOverlayProps): React.JSX.Element {
  const outline = CAPTURE_OUTLINES[sex][view];
  const viewBoxWidth = Number(outline.viewBox.split(' ')[2]);
  const aligned = gate === 'aligned';
  const tone = aligned ? GREEN : RED;
  const traced = Math.max(0, Math.min(1, holdProgress));

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-[6%]">
      <svg
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
    </div>
  );
}
