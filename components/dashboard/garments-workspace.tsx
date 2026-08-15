'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FC } from 'react';

import { GarmentForm } from '@/components/dashboard/garment-form';
import { GarmentTable } from '@/components/dashboard/garment-table';
import { VFRCanvas } from '@/components/vfr/vfr-canvas';
import { VFRControls } from '@/components/vfr/vfr-controls';
import type { GarmentCadProfileRow } from '@/types/database';
import type { GarmentMeshProps, ViewportConfig } from '@/types/graphics';

export interface GarmentsWorkspaceProps {
  initialProfiles: GarmentCadProfileRow[];
}

const FALLBACK_PATTERN_URL = 'https://placehold.co/512x512/1e293b/e2e8f0?text=Fabric';

const DEFAULT_VIEWPORT_CONFIG: ViewportConfig = {
  showHeatmap: true,
  showWireframe: false,
  autoRotate: true,
};

export const GarmentsWorkspace: FC<GarmentsWorkspaceProps> = ({ initialProfiles }) => {
  const router = useRouter();
  const [profiles, setProfiles] = useState<GarmentCadProfileRow[]>(initialProfiles);
  const [selectedProfile, setSelectedProfile] = useState<GarmentCadProfileRow | null>(
    initialProfiles[0] ?? null,
  );
  const [editingProfile, setEditingProfile] = useState<GarmentCadProfileRow | null>(null);
  const [viewportConfig, setViewportConfig] = useState<ViewportConfig>(DEFAULT_VIEWPORT_CONFIG);

  useEffect(() => {
    setProfiles(initialProfiles);

    if (initialProfiles.length === 0) {
      setSelectedProfile(null);
      return;
    }

    setSelectedProfile((current) => {
      if (!current) {
        return initialProfiles[0];
      }

      const stillExists = initialProfiles.some((profile) => profile.id === current.id);
      return stillExists ? current : initialProfiles[0];
    });
  }, [initialProfiles]);

  const previewGarment = useMemo<GarmentMeshProps>(() => {
    if (!selectedProfile) {
      return {
        cadPatternUrl: FALLBACK_PATTERN_URL,
        tensileStiffness: 1.0,
        bendingRigidity: 0.1,
        shearStiffness: 0.5,
        areaDensity: 0.2,
      };
    }

    return {
      cadPatternUrl: selectedProfile.cad_pattern_url ?? FALLBACK_PATTERN_URL,
      tensileStiffness: selectedProfile.tensile_stiffness,
      bendingRigidity: selectedProfile.bending_rigidity,
      shearStiffness: selectedProfile.shear_stiffness,
      areaDensity: selectedProfile.area_density,
    };
  }, [selectedProfile]);

  const refreshProfiles = (): void => {
    router.refresh();
    setEditingProfile(null);
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-100">CAD Garment Manager</h1>
        <p className="mt-1 text-sm text-slate-400">
          Manage merchant CAD mechanical profiles and preview live WebGL draping.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="flex flex-col gap-6">
          <GarmentForm
            editingProfile={editingProfile}
            onSaved={refreshProfiles}
            onCancelEdit={() => setEditingProfile(null)}
          />
          <GarmentTable
            profiles={profiles}
            selectedProfileId={selectedProfile?.id ?? null}
            onSelectProfile={setSelectedProfile}
            onEditProfile={setEditingProfile}
            onDeleted={refreshProfiles}
          />
        </div>

        <section className="relative min-h-[620px] rounded-xl border border-slate-800 bg-slate-900/40 p-3">
          <div className="mb-3 px-2">
            <h2 className="text-lg font-semibold text-slate-100">Live Drape Preview</h2>
            <p className="text-sm text-slate-400">
              {selectedProfile
                ? `${selectedProfile.name} (${selectedProfile.sku})`
                : 'Select a garment to preview'}
            </p>
          </div>

          <VFRCanvas garment={previewGarment} config={viewportConfig} className="h-[560px] w-full" />
          <VFRControls config={viewportConfig} onConfigChange={setViewportConfig} />
        </section>
      </div>
    </div>
  );
};
