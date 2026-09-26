import { useId, type JSX } from 'react';

/** Faceless dress form, cool gray, with a wool coat. Decorative. */
export function ProductStage(): JSX.Element {
  const woolId = useId().replace(/:/g, '');
  const studioId = `${woolId}-studio`;

  return (
    <figure className="relative mx-auto w-full max-w-[420px]" aria-hidden="true">
      <div
        className="pointer-events-none absolute -inset-8 -z-10 rounded-full bg-[radial-gradient(circle,rgba(106,50,201,0.45),transparent_68%)]"
      />
      <div className="overflow-hidden rounded-[28px] border border-white/15 bg-[#12121f] shadow-[0_40px_90px_rgba(0,0,0,0.55)]">
        <div className="flex items-center justify-between px-5 py-4">
          <p className="text-[15px] text-obsidian-ink">Wool coat</p>
          <p className="rounded-full bg-white/10 px-3 py-1 text-[13px] text-obsidian-ink">Try on</p>
        </div>
        <svg viewBox="0 0 360 480" className="h-auto w-full" fill="none">
          <rect width="360" height="480" fill={`url(#${studioId})`} />
          <ellipse cx="180" cy="430" rx="46" ry="8" fill="#3A3A55" />
          <rect x="177" y="368" width="6" height="62" rx="3" fill="#B7BECC" />
          <path
            d="M180 168 L146 118 L112 108 L62 162 L104 262 L138 236 L132 368 H228 L222 236 L256 262 L298 162 L248 108 L214 118 Z"
            fill={`url(#${woolId})`}
          />
          <path d="M146 122 L180 168 L214 122" stroke="#E8E4F2" strokeOpacity="0.7" strokeWidth="1.5" />
          <ellipse cx="180" cy="96" rx="14" ry="9" fill="#D7DCE6" />
          <rect x="170" y="100" width="20" height="22" rx="8" fill="#C5CCD6" />
          <defs>
            <radialGradient id={studioId} cx="50%" cy="32%" r="72%">
              <stop offset="0" stopColor="#322652" />
              <stop offset="1" stopColor="#0E0E18" />
            </radialGradient>
            <linearGradient id={woolId} x1="80" y1="110" x2="260" y2="380" gradientUnits="userSpaceOnUse">
              <stop stopColor="#8B78B0" />
              <stop offset="0.55" stopColor="#4E3D74" />
              <stop offset="1" stopColor="#241C3A" />
            </linearGradient>
          </defs>
        </svg>
        <div className="grid grid-cols-2 border-t border-white/10">
          <div className="px-5 py-4">
            <p className="text-[13px] text-obsidian-subtle">In the cart</p>
            <p className="mt-1 text-lg font-medium tabular-nums text-obsidian-ink">Size M</p>
          </div>
          <div className="border-l border-white/10 px-5 py-4">
            <p className="text-[13px] text-obsidian-subtle">If a check fails</p>
            <p className="mt-1 text-lg font-medium text-obsidian-ink">Approximate fit</p>
          </div>
        </div>
      </div>
    </figure>
  );
}
