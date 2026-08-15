'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { VFRCanvas } from '@/components/vfr/vfr-canvas';
import { VFRControls } from '@/components/vfr/vfr-controls';
import { postWidgetEvent, subscribeToHostEvents } from '@/lib/widget/bridge';
import type { AvatarMeasurements, GarmentMeshProps, ViewportConfig } from '@/types/graphics';

export interface StorefrontGarmentProfile extends GarmentMeshProps {
  sku: string;
}

interface StorefrontViewportProps {
  garments: StorefrontGarmentProfile[];
  initialSku: string;
  targetOrigin: string;
}

const DEFAULT_AVATAR: AvatarMeasurements = {
  heightCm: 175,
  chestCm: 100,
  waistCm: 82,
};

const DEFAULT_VIEWPORT_CONFIG: ViewportConfig = {
  autoRotate: true,
  showHeatmap: true,
  showWireframe: false,
};

function clampMeasurement(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function recommendSize(chestCm: number): string {
  if (chestCm < 90) {
    return 'S';
  }

  if (chestCm <= 108) {
    return 'M';
  }

  if (chestCm <= 120) {
    return 'L';
  }

  return 'XL';
}

export function StorefrontViewport({
  garments,
  initialSku,
  targetOrigin,
}: StorefrontViewportProps): React.JSX.Element {
  const rootRef = useRef<HTMLElement | null>(null);
  const garmentBySku = useMemo(
    () => new Map(garments.map((garment) => [garment.sku, garment])),
    [garments],
  );
  const initialGarment = garmentBySku.get(initialSku) ?? garments[0];

  if (!initialGarment) {
    throw new Error('StorefrontViewport requires at least one garment profile.');
  }

  const [activeGarment, setActiveGarment] = useState(initialGarment);
  const [avatar, setAvatar] = useState<AvatarMeasurements>(DEFAULT_AVATAR);
  const [viewportConfig, setViewportConfig] = useState<ViewportConfig>(DEFAULT_VIEWPORT_CONFIG);

  useEffect(() => {
    return subscribeToHostEvents(targetOrigin, (event) => {
      if (event.type === 'VFR_SET_GARMENT') {
        const nextGarment = garmentBySku.get(event.payload.sku);
        if (nextGarment) {
          setActiveGarment(nextGarment);
        }
        return;
      }

      setAvatar((currentAvatar) => ({
        heightCm: event.payload.heightCm === undefined
          ? currentAvatar.heightCm
          : clampMeasurement(event.payload.heightCm, 120, 230),
        chestCm: event.payload.chestCm === undefined
          ? currentAvatar.chestCm
          : clampMeasurement(event.payload.chestCm, 60, 180),
        waistCm: event.payload.waistCm === undefined
          ? currentAvatar.waistCm
          : clampMeasurement(event.payload.waistCm, 45, 160),
      }));
    });
  }, [garmentBySku, targetOrigin]);

  useEffect(() => {
    postWidgetEvent(
      { type: 'VFR_WIDGET_READY', payload: { sku: activeGarment.sku } },
      targetOrigin,
    );
    postWidgetEvent(
      { type: 'VFR_SIZE_RECOMMENDED', payload: { size: recommendSize(avatar.chestCm) } },
      targetOrigin,
    );
  }, [activeGarment.sku, avatar.chestCm, targetOrigin]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      postWidgetEvent(
        {
          type: 'VFR_RESIZE_VIEWPORT',
          payload: { height: Math.ceil(entry.contentRect.height) },
        },
        targetOrigin,
      );
    });

    observer.observe(root);
    return () => observer.disconnect();
  }, [targetOrigin]);

  return (
    <main
      ref={rootRef}
      className="relative min-h-[420px] overflow-hidden bg-slate-950 text-slate-100"
    >
      {/*
       * VFRCanvas owns the Three.js renderer and disposes its renderer, scene,
       * geometry, materials, textures, render targets, and controls on unmount.
       */}
      <VFRCanvas
        avatar={avatar}
        garment={activeGarment}
        config={viewportConfig}
        className="h-[min(72vw,620px)] min-h-[420px] w-full"
      />
      <VFRControls config={viewportConfig} onConfigChange={setViewportConfig} />
    </main>
  );
}
