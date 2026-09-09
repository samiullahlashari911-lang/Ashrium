import type { CaptureView, PoseGateStatus } from '@/types/hmr';

interface SilhouetteOverlayProps {
  view: CaptureView;
  gate?: PoseGateStatus;
}

function strokeForGate(gate: PoseGateStatus): string {
  switch (gate) {
    case 'aligned':
      return 'rgba(16, 185, 129, 0.96)';
    case 'too_close':
    case 'too_far':
      return 'rgba(251, 191, 36, 0.94)';
    case 'raise_wrists':
    case 'turn_required':
      return 'rgba(196, 181, 253, 0.96)';
    default:
      return 'rgba(248, 250, 252, 0.92)';
  }
}

function fillForGate(gate: PoseGateStatus): string {
  if (gate === 'aligned') {
    return 'rgba(16, 185, 129, 0.14)';
  }
  if (gate === 'too_close' || gate === 'too_far') {
    return 'rgba(251, 191, 36, 0.1)';
  }
  return 'rgba(248, 250, 252, 0.08)';
}

export function SilhouetteOverlay({
  view,
  gate = 'not_detected',
}: SilhouetteOverlayProps): React.JSX.Element {
  const stroke = strokeForGate(gate);
  const fill = fillForGate(gate);
  const aligned = gate === 'aligned';
  const dash = aligned ? undefined : '5 5';

  return (
    <svg
      className={[
        'pointer-events-none absolute inset-[8%] h-[84%] w-[84%]',
        aligned ? 'capture-guide-aligned' : 'capture-guide-stroke',
      ].join(' ')}
      viewBox="0 0 200 360"
      aria-hidden="true"
    >
      <defs>
        <filter id="capture-guide-glow" x="-24%" y="-12%" width="148%" height="124%">
          <feGaussianBlur stdDeviation="1.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <ellipse cx="100" cy="338" rx="48" ry="9" fill={fill} stroke={stroke} strokeWidth="1.2" opacity="0.5" />

      {view === 'front' ? (
        <g
          filter="url(#capture-guide-glow)"
          fill={fill}
          stroke={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <ellipse cx="100" cy="46" rx="18" ry="22" strokeWidth="2.8" />
          <path d="M100 68v14" fill="none" strokeWidth="2.8" />
          <path
            d="M78 86c0-6 10-10 22-10s22 4 22 10c8 8 16 20 20 34 2 6-2 10-8 8l-12-28c-2-4-8-8-14-8h-16c-6 0-12 4-14 8l-12 28c-6 2-10-2-8-8 4-14 12-26 20-34z"
            strokeWidth="2.8"
          />
          <rect x="78" y="118" width="44" height="92" rx="16" strokeWidth="2.8" />
          <path d="M86 206v108c0 6 6 12 14 12" fill="none" strokeWidth="2.8" />
          <path d="M114 206v108c0 6-6 12-14 12" fill="none" strokeWidth="2.8" />
          <path d="M72 326h28M100 326h28" fill="none" strokeWidth="3.2" />
          <path d="M78 96C58 118 42 138 34 154" fill="none" strokeWidth="2.6" strokeDasharray={dash} />
          <path d="M122 96C142 118 158 138 166 154" fill="none" strokeWidth="2.6" strokeDasharray={dash} />
          <circle cx="32" cy="156" r="12" fill="none" strokeWidth="2.4" strokeDasharray={dash} />
          <circle cx="168" cy="156" r="12" fill="none" strokeWidth="2.4" strokeDasharray={dash} />
        </g>
      ) : (
        <g
          filter="url(#capture-guide-glow)"
          fill={fill}
          stroke={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <ellipse cx="114" cy="46" rx="15" ry="22" strokeWidth="2.8" />
          <path d="M114 68v16" fill="none" strokeWidth="2.8" />
          <rect x="98" y="84" width="32" height="118" rx="16" strokeWidth="2.8" />
          <path d="M110 200v112c0 6 4 12 10 12" fill="none" strokeWidth="2.8" />
          <path d="M96 324h32" fill="none" strokeWidth="3.2" />
          <path d="M114 96c12-8 20-22 16-40" fill="none" strokeWidth="2.6" strokeDasharray={dash} />
          <circle cx="128" cy="52" r="12" fill="none" strokeWidth="2.4" strokeDasharray={dash} />
        </g>
      )}
    </svg>
  );
}
