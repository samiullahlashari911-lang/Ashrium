import type { ConfidenceGateResult } from '@/types/garment';

interface ConfidenceBadgeProps {
  sizeCode: string | null;
  gate: ConfidenceGateResult | null;
}

export function ConfidenceBadge({ sizeCode, gate }: ConfidenceBadgeProps): React.JSX.Element {
  if (!gate || !sizeCode) {
    return (
      <div className="rounded-full border border-dashed border-white/20 px-3 py-1.5 text-xs text-obsidian-subtle">
        No size result yet
      </div>
    );
  }

  if (gate.highConfidence) {
    return (
      <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white">
        Size {sizeCode}
      </div>
    );
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <div className="rounded-full border border-white/35 bg-transparent px-3 py-1.5 text-xs font-semibold text-obsidian-muted">
        Approximate fit
      </div>
      <p className="max-w-[14rem] text-right text-[11px] leading-snug text-obsidian-subtle">
        Suggested {sizeCode} — not a size claim until capture, ingest, and drape all pass.
      </p>
    </div>
  );
}
