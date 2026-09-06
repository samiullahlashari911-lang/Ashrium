import type { JSX, ReactNode } from 'react';

export { AshriumMark } from '@/components/brand/ashrium-logo';

export type AtmosphereIntensity = 'hero' | 'subtle';

interface AtmosphereBackdropProps {
  intensity?: AtmosphereIntensity;
}

export function AtmosphereBackdrop({
  intensity = 'subtle',
}: AtmosphereBackdropProps): JSX.Element {
  const isHero = intensity === 'hero';

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div
        className={
          isHero
            ? 'absolute left-1/2 top-[44%] h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(106,50,201,0.42),transparent_64%)]'
            : 'absolute left-1/2 top-0 h-[360px] w-[640px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(106,50,201,0.22),transparent_70%)]'
        }
      />

      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1200 800"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
      >
        <defs>
          <radialGradient id="obsidian-sphere" cx="32%" cy="28%" r="70%">
            <stop offset="0%" stopColor="#6B4AA8" />
            <stop offset="42%" stopColor="#2A1858" />
            <stop offset="100%" stopColor="#0E0A22" />
          </radialGradient>
          <radialGradient id="obsidian-crystal" cx="38%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#4A5AA8" />
            <stop offset="55%" stopColor="#1C2458" />
            <stop offset="100%" stopColor="#0B1028" />
          </radialGradient>
          <linearGradient id="obsidian-ring" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#5B3A9A" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#3A2068" stopOpacity="0.45" />
          </linearGradient>
          <filter id="obsidian-soft" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation={isHero ? 6 : 10} />
          </filter>
        </defs>

        <circle
          cx={isHero ? 210 : 160}
          cy={isHero ? 150 : 90}
          r={isHero ? 168 : 110}
          fill="url(#obsidian-sphere)"
          opacity={isHero ? 0.95 : 0.55}
          filter="url(#obsidian-soft)"
        />

        <ellipse
          cx="600"
          cy={isHero ? 390 : 320}
          rx={isHero ? 340 : 280}
          ry={isHero ? 118 : 90}
          stroke="url(#obsidian-ring)"
          strokeWidth={isHero ? 42 : 28}
          transform={isHero ? 'rotate(-18 600 390)' : 'rotate(-16 600 320)'}
          opacity={isHero ? 0.72 : 0.35}
        />

        <polygon
          points={
            isHero
              ? '980,470 1088,510 1124,620 1048,710 932,680 900,560'
              : '1040,520 1120,555 1145,640 1088,705 1000,680 978,590'
          }
          fill="url(#obsidian-crystal)"
          opacity={isHero ? 0.88 : 0.4}
          filter="url(#obsidian-soft)"
        />
      </svg>
    </div>
  );
}

export function ThemeShell({
  children,
  intensity = 'subtle',
}: {
  children: ReactNode;
  intensity?: AtmosphereIntensity;
}): JSX.Element {
  return (
    <div className="relative min-h-screen bg-obsidian-canvas text-obsidian-ink">
      <AtmosphereBackdrop intensity={intensity} />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
