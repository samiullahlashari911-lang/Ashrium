'use client';

import { useTransition, type FC } from 'react';

import { deleteGarmentProfile } from '@/lib/server/garments';
import type { GarmentCadProfileRow } from '@/types/database';

export interface GarmentTableProps {
  profiles: GarmentCadProfileRow[];
  selectedProfileId: string | null;
  onSelectProfile: (profile: GarmentCadProfileRow) => void;
  onEditProfile: (profile: GarmentCadProfileRow) => void;
  onDeleted: () => void;
}

export const GarmentTable: FC<GarmentTableProps> = ({
  profiles,
  selectedProfileId,
  onSelectProfile,
  onEditProfile,
  onDeleted,
}) => {
  const [isPending, startTransition] = useTransition();

  const handleDelete = (profileId: string): void => {
    const confirmed = window.confirm('Delete this CAD garment profile?');
    if (!confirmed) {
      return;
    }

    startTransition(async () => {
      await deleteGarmentProfile(profileId);
      onDeleted();
    });
  };

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg">
      <header className="mb-4 border-b border-slate-800 pb-3">
        <h2 className="text-lg font-semibold text-slate-100">CAD Garment Library</h2>
        <p className="text-sm text-slate-400">
          Tenant-scoped profiles enforced by Supabase RLS.
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm text-slate-200">
          <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">S_t</th>
              <th className="px-3 py-2">B_r</th>
              <th className="px-3 py-2">S_s</th>
              <th className="px-3 py-2">rho_a</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {profiles.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                  No CAD garment profiles yet. Create your first profile above.
                </td>
              </tr>
            ) : (
              profiles.map((profile) => {
                const isSelected = selectedProfileId === profile.id;

                return (
                  <tr
                    key={profile.id}
                    className={[
                      'border-b border-slate-800/80 transition hover:bg-slate-800/40',
                      isSelected ? 'bg-sky-500/10' : '',
                    ].join(' ')}
                  >
                    <td className="px-3 py-3 font-mono text-xs">{profile.sku}</td>
                    <td className="px-3 py-3">{profile.name}</td>
                    <td className="px-3 py-3">{profile.tensile_stiffness.toFixed(2)}</td>
                    <td className="px-3 py-3">{profile.bending_rigidity.toFixed(2)}</td>
                    <td className="px-3 py-3">{profile.shear_stiffness.toFixed(2)}</td>
                    <td className="px-3 py-3">{profile.area_density.toFixed(2)}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => onSelectProfile(profile)}
                          className="rounded-md border border-slate-700 px-2 py-1 text-xs font-semibold text-slate-200 hover:border-sky-500"
                        >
                          Preview
                        </button>
                        <button
                          type="button"
                          onClick={() => onEditProfile(profile)}
                          className="rounded-md border border-slate-700 px-2 py-1 text-xs font-semibold text-slate-200 hover:border-emerald-500"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => handleDelete(profile.id)}
                          className="rounded-md border border-red-900/60 px-2 py-1 text-xs font-semibold text-red-300 hover:border-red-500 disabled:opacity-60"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};
