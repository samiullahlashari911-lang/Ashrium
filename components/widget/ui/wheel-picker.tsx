'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react';

export interface WheelPickerItem {
  value: number;
  label: string;
}

interface WheelPickerProps {
  items: ReadonlyArray<WheelPickerItem>;
  value: number;
  onChange: (value: number) => void;
  /** Fires once on the first real user gesture (scroll, tap, key). */
  onInteract?: () => void;
  ariaLabel: string;
  itemHeightPx?: number;
  visibleItems?: number;
}

/** Items further than this from centre keep the resting style. */
const WHEEL_REACH = 4;

function nearestIndex(items: ReadonlyArray<WheelPickerItem>, value: number): number {
  let best = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  items.forEach((item, index) => {
    const delta = Math.abs(item.value - value);
    if (delta < bestDelta) {
      best = index;
      bestDelta = delta;
    }
  });
  return best;
}

/**
 * iOS-style wheel: native momentum scroll + scroll-snap for feel, and a
 * rAF-driven 3D curve (rotateX / scale / fade) written straight to the DOM so
 * React never re-renders mid-flick. `onChange` fires only when the centred
 * item changes.
 */
export function WheelPicker({
  items,
  value,
  onChange,
  onInteract,
  ariaLabel,
  itemHeightPx = 48,
  visibleItems = 5,
}: WheelPickerProps): React.JSX.Element {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const styledRef = useRef<Set<number>>(new Set());
  const frameRef = useRef<number | null>(null);
  const programmaticRef = useRef(false);
  const interactedRef = useRef(false);
  const indexRef = useRef(nearestIndex(items, value));
  const onChangeRef = useRef(onChange);
  const onInteractRef = useRef(onInteract);
  onChangeRef.current = onChange;
  onInteractRef.current = onInteract;

  const padPx = ((visibleItems - 1) / 2) * itemHeightPx;

  const paint = useCallback(() => {
    frameRef.current = null;
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }

    const position = scroller.scrollTop / itemHeightPx;
    const centre = Math.min(items.length - 1, Math.max(0, Math.round(position)));
    const touched = new Set<number>();

    for (let index = centre - WHEEL_REACH; index <= centre + WHEEL_REACH; index += 1) {
      const element = itemRefs.current[index];
      if (!element) {
        continue;
      }
      const distance = index - position;
      const reach = Math.min(Math.abs(distance), 3);
      element.style.transform = `perspective(420px) rotateX(${(-distance * 17).toFixed(2)}deg) scale(${(1 - reach * 0.07).toFixed(3)})`;
      element.style.opacity = Math.max(0.12, 1 - reach * 0.3).toFixed(3);
      touched.add(index);
    }

    styledRef.current.forEach((index) => {
      if (touched.has(index)) {
        return;
      }
      const element = itemRefs.current[index];
      if (element) {
        element.style.transform = '';
        element.style.opacity = '';
      }
    });
    styledRef.current = touched;

    if (centre !== indexRef.current) {
      indexRef.current = centre;
      const next = items[centre];
      if (next) {
        onChangeRef.current(next.value);
      }
    }
  }, [itemHeightPx, items]);

  const schedulePaint = useCallback(() => {
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(paint);
    }
  }, [paint]);

  const markInteracted = useCallback(() => {
    if (interactedRef.current) {
      return;
    }
    interactedRef.current = true;
    onInteractRef.current?.();
  }, []);

  const scrollToIndex = useCallback(
    (index: number, behavior: ScrollBehavior) => {
      const scroller = scrollerRef.current;
      if (!scroller) {
        return;
      }
      const clamped = Math.min(items.length - 1, Math.max(0, index));
      scroller.scrollTo({ top: clamped * itemHeightPx, behavior });
    },
    [itemHeightPx, items.length],
  );

  // Re-centre when the item list changes (e.g. cm ↔ ft-in) without firing a
  // user interaction.
  useLayoutEffect(() => {
    const index = nearestIndex(items, value);
    indexRef.current = index;
    const scroller = scrollerRef.current;
    if (scroller) {
      programmaticRef.current = true;
      scroller.scrollTop = index * itemHeightPx;
    }
    paint();
    const release = requestAnimationFrame(() => {
      programmaticRef.current = false;
    });
    return () => cancelAnimationFrame(release);
    // `value` intentionally omitted: scrolling drives value, not the reverse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, itemHeightPx]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    },
    [],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step =
      event.key === 'ArrowUp' ? -1
        : event.key === 'ArrowDown' ? 1
          : event.key === 'PageUp' ? -5
            : event.key === 'PageDown' ? 5
              : 0;
    if (step === 0) {
      return;
    }
    event.preventDefault();
    markInteracted();
    scrollToIndex(indexRef.current + step, 'smooth');
  };

  const selected = items[nearestIndex(items, value)];

  return (
    <div className="relative w-full select-none" style={{ height: itemHeightPx * visibleItems }}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/2 z-0 -translate-y-1/2 rounded-2xl bg-ash-accent-soft"
        style={{ height: itemHeightPx }}
      />
      <div
        ref={scrollerRef}
        role="listbox"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-activedescendant={selected ? `${ariaLabel}-${selected.value}` : undefined}
        onScroll={() => {
          if (!programmaticRef.current) {
            markInteracted();
          }
          schedulePaint();
        }}
        onPointerDown={markInteracted}
        onKeyDown={handleKeyDown}
        className="ash-wheel relative z-10 h-full snap-y snap-mandatory overflow-y-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-ash-accent/40 rounded-2xl"
        style={{ paddingTop: padPx, paddingBottom: padPx }}
      >
        {items.map((item, index) => (
          <button
            key={item.value}
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            id={`${ariaLabel}-${item.value}`}
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={item.value === selected?.value}
            onClick={() => {
              markInteracted();
              scrollToIndex(index, 'smooth');
            }}
            className={[
              'flex w-full snap-center items-center justify-center text-[22px] tabular-nums tracking-tight will-change-transform',
              item.value === selected?.value ? 'font-semibold text-ash-ink' : 'font-medium text-ash-muted',
            ].join(' ')}
            style={{ height: itemHeightPx, opacity: 0.12 }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
