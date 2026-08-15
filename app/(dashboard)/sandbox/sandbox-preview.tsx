'use client';

import { useState, type ChangeEvent, type FC } from 'react';

import { VFRCanvas } from '@/components/vfr/vfr-canvas';
import { VFRControls } from '@/components/vfr/vfr-controls';
import type { AvatarMeasurements, GarmentMeshProps, ViewportConfig } from '@/types/graphics';

interface DemoGarment {
  description: string;
  garment: GarmentMeshProps;
  name: string;
  sku: string;
}

const DEMO_GARMENTS: readonly DemoGarment[] = [
  {
    sku: 'DEMO-TEE-001',
    name: 'T-Shirt',
    description: 'Soft knit with balanced stretch for everyday fit testing.',
    garment: {
      cadPatternUrl: 'https://placehold.co/512x512/1e293b/e2e8f0?text=Cotton+T-Shirt',
      tensileStiffness: 75,
      bendingRigidity: 0.03,
      shearStiffness: 45,
      areaDensity: 0.18,
    },
  },
  {
    sku: 'DEMO-DENIM-002',
    name: 'Denim Jeans',
    description: 'Structured denim with high tensile stiffness and density.',
    garment: {
      cadPatternUrl: 'https://placehold.co/512x512/1e293b/e2e8f0?text=Denim+Jeans',
      tensileStiffness: 190,
      bendingRigidity: 0.16,
      shearStiffness: 125,
      areaDensity: 0.42,
    },
  },
  {
    sku: 'DEMO-SILK-003',
    name: 'Silk Dress',
    description: 'Lightweight silk designed to reveal flow and drape behavior.',
    garment: {
      cadPatternUrl: 'https://placehold.co/512x512/1e293b/e2e8f0?text=Silk+Dress',
      tensileStiffness: 38,
      bendingRigidity: 0.008,
      shearStiffness: 24,
      areaDensity: 0.09,
    },
  },
];

const INITIAL_AVATAR: AvatarMeasurements = {
  heightCm: 175,
  chestCm: 100,
  waistCm: 82,
};

const INITIAL_VIEWPORT_CONFIG: ViewportConfig = {
  showHeatmap: true,
  showWireframe: false,
  autoRotate: true,
};

interface MeasurementSliderProps {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  unit: string;
  value: number;
}

const MeasurementSlider: FC<MeasurementSliderProps> = ({
  label,
  max,
  min,
  onChange,
  unit,
  value,
}) => {
  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onChange(Number(event.target.value));
  };

  return (
    <label className="flex flex-col gap-2 text-sm text-slate-300">
      <span className="flex items-center justify-between">
        <span>{label}</span>
        <span className="font-mono text-sky-200">
          {value} {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={handleChange}
        className="accent-sky-400"
      />
    </label>
  );
};

export const SandboxPreview: FC = () => {
  const [selectedSku, setSelectedSku] = useState<string>(DEMO_GARMENTS[0].sku);
  const [avatar, setAvatar] = useState<AvatarMeasurements>(INITIAL_AVATAR);
  const [viewportConfig, setViewportConfig] = useState<ViewportConfig>(INITIAL_VIEWPORT_CONFIG);

  const selectedGarment = DEMO_GARMENTS.find((garment) => garment.sku === selectedSku)
    ?? DEMO_GARMENTS[0];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 p-6">
      <header>
        <p className="text-sm font-medium text-sky-300">Merchant VFR Sandbox</p>
        <h1 className="mt-1 text-3xl font-bold text-slate-100">Interactive fit preview</h1>
        <p className="mt-2 text-sm text-slate-400">
          Test demo garments against adjustable body measurements and inspect live strain.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-6">
          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg backdrop-blur">
            <h2 className="text-lg font-semibold text-slate-100">Demo garments</h2>
            <div className="mt-4 flex flex-col gap-3">
              {DEMO_GARMENTS.map((garment) => {
                const isSelected = garment.sku === selectedSku;

                return (
                  <button
                    key={garment.sku}
                    type="button"
                    onClick={() => setSelectedSku(garment.sku)}
                    className={[
                      'rounded-lg border p-4 text-left transition',
                      isSelected
                        ? 'border-sky-400/70 bg-sky-500/15'
                        : 'border-slate-700 bg-slate-950/60 hover:border-slate-500',
                    ].join(' ')}
                  >
                    <span className="block font-semibold text-slate-100">{garment.name}</span>
                    <span className="mt-1 block text-xs text-slate-400">{garment.description}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg backdrop-blur">
            <h2 className="text-lg font-semibold text-slate-100">Body avatar</h2>
            <p className="mt-1 text-sm text-slate-400">
              Measurements update the collision body used by the live drape preview.
            </p>
            <div className="mt-5 flex flex-col gap-5">
              <MeasurementSlider
                label="Height"
                min={150}
                max={205}
                unit="cm"
                value={avatar.heightCm}
                onChange={(heightCm) => setAvatar((current) => ({ ...current, heightCm }))}
              />
              <MeasurementSlider
                label="Chest"
                min={75}
                max={135}
                unit="cm"
                value={avatar.chestCm}
                onChange={(chestCm) => setAvatar((current) => ({ ...current, chestCm }))}
              />
              <MeasurementSlider
                label="Waist"
                min={60}
                max={125}
                unit="cm"
                value={avatar.waistCm}
                onChange={(waistCm) => setAvatar((current) => ({ ...current, waistCm }))}
              />
            </div>
          </section>
        </aside>

        <section className="relative min-h-[650px] rounded-xl border border-slate-800 bg-slate-900/40 p-3 shadow-lg">
          <div className="mb-3 px-2">
            <p className="font-mono text-xs text-sky-300">{selectedGarment.sku}</p>
            <h2 className="text-lg font-semibold text-slate-100">{selectedGarment.name}</h2>
          </div>
          <VFRCanvas
            garment={selectedGarment.garment}
            avatar={avatar}
            config={viewportConfig}
            className="h-[600px] w-full"
          />
          <VFRControls config={viewportConfig} onConfigChange={setViewportConfig} />
        </section>
      </div>
    </main>
  );
};
