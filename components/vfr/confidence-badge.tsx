import type { ConfidenceGateResult } from '@/types/garment';

interface ConfidenceBadgeProps {
  sizeCode: string | null;
  gate: ConfidenceGateResult | null;
}

/**
 * Solid badge = every AND-gate check passed (a real size claim). Outlined =
 * approximate, always with the reason, so it can never be mistaken for the
 * confident state.
 */
export function ConfidenceBadge({ sizeCode, gate }: ConfidenceBadgeProps): React.JSX.Element {
  if (!gate || !sizeCode) {
    return (
      <span className="inline-flex items-center rounded-full border border-dashed border-ash-line px-3 py-1 text-xs font-medium text-ash-subtle">
        No size yet
      </span>
    );
  }

  if (gate.highConfidence) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-ash-success px-3 py-1 text-xs font-semibold text-white">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Confident fit
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      Approximate fit
    </span>
  );
}
