import { captureFlowProgress, type CaptureFlowStep } from '@/lib/widget/capture-progress';

export function CaptureFlowMeter({ step }: { step: CaptureFlowStep }): React.JSX.Element {
  const progress = captureFlowProgress(step);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-obsidian-subtle">
        {progress.statusLine}
      </p>
      <div className="flex gap-1.5" aria-hidden="true">
        {Array.from({ length: progress.total }, (_, index) => {
          const stepNumber = index + 1;
          const reached = stepNumber <= progress.current;
          return (
            <span
              key={stepNumber}
              className={[
                'h-1 flex-1 rounded-full',
                reached
                  ? 'bg-gradient-to-r from-obsidian-accent to-obsidian-accent-end'
                  : 'bg-white/12',
              ].join(' ')}
            />
          );
        })}
      </div>
    </div>
  );
}
