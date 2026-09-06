'use client';

import { useId, type JSX } from 'react';

const ASHRIUM_MARK_PATH =
  'M100 2 L198 65 L198 96 L181 84 L181 73 L109 27 L109 173 L141 141 L141 74 L198 117 L180 137 L180 122 L158 108 L158 149 L100 206 L42 149 L42 108 L20 122 L20 137 L2 117 L59 74 L59 141 L91 173 L91 27 L19 73 L19 84 L2 96 L2 65 Z';

export type AshriumMarkVariant = 'metallic' | 'currentColor';

export interface AshriumMarkProps {
  className?: string;
  title?: string;
  variant?: AshriumMarkVariant;
}

export function AshriumMark({
  className,
  title,
  variant = 'metallic',
}: AshriumMarkProps): JSX.Element {
  const reactId = useId().replace(/:/g, '');
  const metalId = `ashrium-mark-metal-${reactId}`;
  const sheenId = `ashrium-mark-sheen-${reactId}`;
  const isMetallic = variant === 'metallic';
  const fill = isMetallic ? `url(#${metalId})` : 'currentColor';

  return (
    <svg
      viewBox="0 0 200 208"
      className={className}
      fill="none"
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {isMetallic ? (
        <defs>
          <linearGradient
            id={metalId}
            x1="28"
            y1="8"
            x2="172"
            y2="200"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#F8FAFC" />
            <stop offset="0.22" stopColor="#E2E8F0" />
            <stop offset="0.48" stopColor="#94A3B8" />
            <stop offset="0.68" stopColor="#CBD5E1" />
            <stop offset="1" stopColor="#64748B" />
          </linearGradient>
          <linearGradient
            id={sheenId}
            x1="100"
            y1="2"
            x2="100"
            y2="206"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.55" />
            <stop offset="0.42" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>
        </defs>
      ) : null}
      <path fill={fill} d={ASHRIUM_MARK_PATH} />
      {isMetallic ? <path fill={`url(#${sheenId})`} d={ASHRIUM_MARK_PATH} /> : null}
    </svg>
  );
}

export interface AshriumWordmarkProps {
  className?: string;
  markClassName?: string;
  wordClassName?: string;
}

export function AshriumWordmark({
  className,
  markClassName,
  wordClassName,
}: AshriumWordmarkProps): JSX.Element {
  return (
    <span className={['inline-flex items-center gap-2.5', className].filter(Boolean).join(' ')}>
      <AshriumMark className={markClassName ?? 'h-7 w-7 shrink-0'} />
      <span className={wordClassName ?? 'text-sm font-medium tracking-[0.04em]'}>Ashrium</span>
    </span>
  );
}
