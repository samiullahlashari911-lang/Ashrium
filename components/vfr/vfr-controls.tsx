'use client';

import type { FC } from 'react';

import type { ViewportConfig } from '@/types/graphics';

export interface VFRControlsProps {
  config: ViewportConfig;
  onConfigChange: (config: ViewportConfig) => void;
  className?: string;
}

interface ToggleButtonProps {
  label: string;
  description: string;
  isActive: boolean;
  onToggle: () => void;
}

const ToggleButton: FC<ToggleButtonProps> = ({
  label,
  description,
  isActive,
  onToggle,
}) => (
  <button
    type="button"
    onClick={onToggle}
    aria-pressed={isActive}
    className={[
      'flex w-full flex-col rounded-lg border px-3 py-2 text-left transition-colors',
      isActive
        ? 'border-obsidian-accent/70 bg-obsidian-accent/15 text-obsidian-ink'
        : 'border-white/10 bg-obsidian-canvas/70 text-obsidian-ink hover:border-white/25',
    ].join(' ')}
  >
    <span className="text-sm font-semibold">{label}</span>
    <span className="text-xs text-obsidian-muted">{description}</span>
  </button>
);

export const VFRControls: FC<VFRControlsProps> = ({
  config,
  onConfigChange,
  className = 'absolute right-4 top-4 z-10 w-64',
}) => {
  const updateConfig = (patch: Partial<ViewportConfig>): void => {
    onConfigChange({ ...config, ...patch });
  };

  return (
    <aside
      className={`${className} obsidian-glass p-4`}
    >
      <header className="mb-3 border-b border-white/10 pb-2">
        <h2 className="text-sm font-semibold text-obsidian-ink">Viewport Controls</h2>
        <p className="text-xs text-obsidian-muted">Garment drape & strain visualization</p>
      </header>

      <div className="flex flex-col gap-2">
        <ToggleButton
          label="Heatmap Mode"
          description="Vertex strain color mapping"
          isActive={config.showHeatmap}
          onToggle={() => updateConfig({ showHeatmap: !config.showHeatmap })}
        />

        <ToggleButton
          label="Wireframe"
          description="Toggle mesh edge overlay"
          isActive={config.showWireframe}
          onToggle={() => updateConfig({ showWireframe: !config.showWireframe })}
        />

        <ToggleButton
          label="Mesh Rotation"
          description="Auto-rotate draped garment"
          isActive={config.autoRotate}
          onToggle={() => updateConfig({ autoRotate: !config.autoRotate })}
        />
      </div>

      <div className="mt-4 rounded-lg border border-white/10 bg-obsidian-canvas/70 p-3 text-xs text-obsidian-muted">
        <p className="mb-2 font-semibold text-obsidian-ink">Strain Legend</p>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-red-500" />
            <span>Constricted (&gt;15% stretch)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-emerald-500" />
            <span>Ideal contour fit</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-blue-500" />
            <span>Loose folds (zero pressure)</span>
          </div>
        </div>
      </div>
    </aside>
  );
};
