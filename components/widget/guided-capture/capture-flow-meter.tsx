import { captureFlowProgress, type CaptureFlowStep } from '@/lib/widget/capture-progress';

/**
 * Progress line: a hairline track whose violet fill glides forward on every
 * Next, with a soft glowing tip so the motion reads as "moving on". Consent
 * is the threshold (empty line); the side photo fills it.
 */
export function CaptureFlowMeter({ step }: { step: CaptureFlowStep }): React.JSX.Element {
  const progress = captureFlowProgress(step);
  const percent = Math.round(progress.fraction * 100);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between text-[11px] font-semibold uppercase tracking-[0.14em]">
        <span className="text-ash-muted">{progress.title}</span>
        {progress.current > 0 ? (
          <span className="tabular-nums text-ash-subtle">
            {progress.current}
            <span className="mx-0.5 text-ash-line">/</span>
            {progress.total}
          </span>
        ) : null}
      </div>
      <div
        className="relative h-[3px] w-full rounded-full bg-ash-line"
        role="progressbar"
        aria-label={progress.statusLine}
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.current}
      >
        <div
          className="ash-progress-fill absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${percent}%` }}
        >
          {percent > 0 ? <span className="ash-progress-tip" aria-hidden="true" /> : null}
        </div>
      </div>
    </div>
  );
}
