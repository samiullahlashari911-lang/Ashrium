'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  formatHeight,
  heightDialValues,
  type HeightUnit,
} from '@/lib/widget/height-units';

const ITEM_HEIGHT_PX = 44;
const VISIBLE_ITEMS = 5;

interface HeightDialProps {
  heightCm: number;
  onChange: (heightCm: number) => void;
  action?: ReactNode;
}

function closestIndex(values: readonly number[], heightCm: number): number {
  let best = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  values.forEach((value, index) => {
    const delta = Math.abs(value - heightCm);
    if (delta < bestDelta) {
      best = index;
      bestDelta = delta;
    }
  });
  return best;
}

export function HeightDial({ heightCm, onChange, action }: HeightDialProps): React.JSX.Element {
  const [unit, setUnit] = useState<HeightUnit>('cm');
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const ignoreScrollRef = useRef(false);
  const heightRef = useRef(heightCm);
  const values = useMemo(() => heightDialValues(unit), [unit]);
  const padPx = ((VISIBLE_ITEMS - 1) / 2) * ITEM_HEIGHT_PX;
  heightRef.current = heightCm;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }

    const index = closestIndex(values, heightRef.current);
    const nearest = values[index];
    if (nearest !== undefined && nearest !== heightRef.current) {
      onChangeRef.current(nearest);
    }

    ignoreScrollRef.current = true;
    scroller.scrollTop = index * ITEM_HEIGHT_PX;
    const frame = requestAnimationFrame(() => {
      ignoreScrollRef.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [values]);

  const handleScroll = (): void => {
    if (ignoreScrollRef.current) {
      return;
    }

    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }

    const index = Math.min(
      values.length - 1,
      Math.max(0, Math.round(scroller.scrollTop / ITEM_HEIGHT_PX)),
    );
    const next = values[index];
    if (next !== undefined && next !== heightCm) {
      onChange(next);
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <div className="grid grid-cols-2 rounded-full border border-white/12 bg-obsidian-canvas p-1">
        {([
          ['cm', 'Centimetres'],
          ['ft_in', 'Feet & inches'],
        ] as const).map(([nextUnit, label]) => {
          const selected = unit === nextUnit;
          return (
            <button
              key={nextUnit}
              type="button"
              onClick={() => setUnit(nextUnit)}
              className={[
                'rounded-full px-3 py-2 text-xs font-semibold',
                selected
                  ? 'bg-obsidian-accent/25 text-obsidian-ink'
                  : 'text-obsidian-muted',
              ].join(' ')}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative h-[220px] min-w-0 flex-1">
          <div
            className="pointer-events-none absolute inset-x-3 top-1/2 z-10 h-11 -translate-y-1/2 rounded-2xl border border-obsidian-accent/40 bg-obsidian-accent/10"
            aria-hidden="true"
          />
          <div
            ref={scrollerRef}
            onScroll={handleScroll}
            className="capture-height-dial h-full snap-y snap-mandatory overflow-y-auto overscroll-contain"
            style={{ paddingTop: padPx, paddingBottom: padPx }}
            role="listbox"
            aria-label="Height"
            aria-activedescendant={`height-tick-${heightCm}`}
          >
            {values.map((value) => {
              const selected = value === heightCm;
              return (
                <button
                  key={`${unit}-${value}`}
                  id={`height-tick-${value}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(value);
                    const scroller = scrollerRef.current;
                    const index = values.indexOf(value);
                    if (scroller && index >= 0) {
                      ignoreScrollRef.current = true;
                      scroller.scrollTo({ top: index * ITEM_HEIGHT_PX, behavior: 'smooth' });
                      requestAnimationFrame(() => {
                        ignoreScrollRef.current = false;
                      });
                    }
                  }}
                  className={[
                    'flex w-full snap-center items-center justify-center text-lg tabular-nums',
                    selected ? 'font-semibold text-obsidian-ink' : 'text-obsidian-subtle',
                  ].join(' ')}
                  style={{ height: ITEM_HEIGHT_PX }}
                >
                  {formatHeight(value, unit)}
                </button>
              );
            })}
          </div>
        </div>
        {action}
      </div>
    </div>
  );
}
