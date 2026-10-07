import type { JSX, ReactNode } from 'react';

export { AshriumMark } from '@/components/brand/ashrium-logo';

export type AtmosphereIntensity = 'hero' | 'subtle';
export type ThemeSurface = 'marketing' | 'dashboard';

interface AtmosphereBackdropProps {
  intensity?: AtmosphereIntensity;
  surface?: ThemeSurface;
}

/**
 * Soft daylight wash behind auth / privacy / dashboard pages: a warm white
 * highlight with a faint violet bloom. Static gradients only (no blur
 * filters) so scrolling never re-composites a layer.
 */
export function AtmosphereBackdrop({
  intensity = 'subtle',
  surface = 'marketing',
}: AtmosphereBackdropProps): JSX.Element {
  const isHero = intensity === 'hero' && surface !== 'dashboard';

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
      <div
        className={
          isHero
            ? 'absolute left-1/2 top-[-12%] h-[720px] w-[1100px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,255,255,0.95),rgba(255,255,255,0)_100%)]'
            : 'absolute left-1/2 top-[-18%] h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,255,255,0.8),rgba(255,255,255,0)_100%)]'
        }
      />
      <div
        className={
          isHero
            ? 'absolute right-[-10%] top-[8%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgba(106,76,245,0.10),transparent)]'
            : 'absolute right-[-12%] top-[-6%] h-[380px] w-[380px] rounded-full bg-[radial-gradient(closest-side,rgba(106,76,245,0.06),transparent)]'
        }
      />
    </div>
  );
}

export function ThemeShell({
  atmosphere = true,
  children,
  intensity = 'subtle',
  surface = 'marketing',
}: {
  atmosphere?: boolean;
  children: ReactNode;
  intensity?: AtmosphereIntensity;
  surface?: ThemeSurface;
}): JSX.Element {
  return (
    <div
      className={[
        'relative min-h-screen bg-ash-canvas text-ash-ink',
        surface === 'dashboard' ? 'dashboard-surface' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {atmosphere ? <AtmosphereBackdrop intensity={intensity} surface={surface} /> : null}
      <div className="relative z-10">{children}</div>
    </div>
  );
}
