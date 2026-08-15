'use client';

import { useState, type FC } from 'react';

import { VFRCanvas } from '@/components/vfr/vfr-canvas';
import { VFRControls } from '@/components/vfr/vfr-controls';
import type { GarmentMeshProps, ViewportConfig } from '@/types/graphics';

export interface WidgetPreviewClientProps {
  garment: GarmentMeshProps;
  initialConfig: ViewportConfig;
}

export const WidgetPreviewClient: FC<WidgetPreviewClientProps> = ({
  garment,
  initialConfig,
}) => {
  const [viewportConfig, setViewportConfig] = useState<ViewportConfig>(initialConfig);

  return (
    <main className="relative min-h-screen bg-slate-950">
      <VFRCanvas garment={garment} config={viewportConfig} className="h-screen w-full" />
      <VFRControls config={viewportConfig} onConfigChange={setViewportConfig} />
    </main>
  );
};
