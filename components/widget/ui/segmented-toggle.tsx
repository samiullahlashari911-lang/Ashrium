'use client';

interface SegmentedToggleProps<T extends string> {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}

/** Two-or-more option switch with a sliding white pill (unit pickers). */
export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: SegmentedToggleProps<T>): React.JSX.Element {
  const index = Math.max(0, options.findIndex((option) => option.value === value));

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="relative grid rounded-full bg-ash-line/60 p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-1 left-1 rounded-full bg-ash-surface shadow-[0_1px_2px_rgba(29,27,34,0.08),0_4px_12px_rgba(29,27,34,0.06)] transition-transform duration-300 [transition-timing-function:var(--ash-ease)]"
        style={{
          width: `calc((100% - 0.5rem) / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={[
              'relative z-10 rounded-full px-4 py-2 text-[13px] font-semibold transition-colors',
              selected ? 'text-ash-ink' : 'text-ash-muted hover:text-ash-ink',
            ].join(' ')}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
