'use client';

import { useTransition, type FC } from 'react';

import { deleteGarmentProfile } from '@/lib/server/garments';
import {
  formatComposition,
  readGarmentComposition,
  readGarmentIngestMode,
  readGarmentIngestTier,
} from '@/types/garment';
import type { GarmentCadProfileRow, GarmentSizeVariantRow } from '@/types/database';

export interface GarmentTableProps {
  profiles: GarmentCadProfileRow[];
  variantsByGarmentId: Record<string, GarmentSizeVariantRow[]>;
  selectedProfileId: string | null;
  onSelectProfile: (profile: GarmentCadProfileRow) => void;
  onEditProfile: (profile: GarmentCadProfileRow) => void;
  onDeleted: () => void;
}

function formatConfidence(value: number | null): string {
  if (value === null) {
    return '—';
  }

  return `${Math.round(value * 100)}%`;
}

export const GarmentTable: FC<GarmentTableProps> = ({
  profiles,
  variantsByGarmentId,
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
    <section className="obsidian-glass p-5">
      <header className="mb-4 border-b border-white/10 pb-3">
        <h2 className="text-lg font-semibold text-obsidian-ink">CAD garment library</h2>
        <p className="text-sm text-obsidian-muted">
          Ingest confidence, KES-mapped mechanics, and GarmentCode size variants. Mode B is
          pipeline-validated from a product-page size chart plus material. Unsupported styles
          stay Approximate with no 3D.
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm text-obsidian-ink">
          <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-obsidian-muted">
            <tr>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Tier</th>
              <th className="px-3 py-2">Mode</th>
              <th className="px-3 py-2">Conf</th>
              <th className="px-3 py-2">GSM</th>
              <th className="px-3 py-2">Composition</th>
              <th className="px-3 py-2">Sizes</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {profiles.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-obsidian-muted">
                  No garments yet. Test one Shopify SKU above or create a profile.
                </td>
              </tr>
            ) : (
              profiles.map((profile) => {
                const isSelected = selectedProfileId === profile.id;
                const variants = variantsByGarmentId[profile.id] ?? [];
                const tier = readGarmentIngestTier(profile.ingest_tier);
                const mode = readGarmentIngestMode(profile.mode);

                return (
                  <tr
                    key={profile.id}
                    className={[
                      'border-b border-white/10 transition hover:bg-white/5',
                      isSelected ? 'bg-obsidian-accent/10' : '',
                    ].join(' ')}
                  >
                    <td className="px-3 py-3 font-mono text-xs">{profile.sku}</td>
                    <td className="px-3 py-3">{profile.name}</td>
                    <td className="px-3 py-3">{profile.category ?? '—'}</td>
                    <td className="px-3 py-3">{tier ?? '—'}</td>
                    <td className="px-3 py-3">{mode ?? '—'}</td>
                    <td className="px-3 py-3">{formatConfidence(profile.ingest_confidence)}</td>
                    <td className="px-3 py-3">{profile.gsm ? Math.round(profile.gsm) : '—'}</td>
                    <td className="px-3 py-3 text-xs">
                      {formatComposition(readGarmentComposition(profile.composition)) || '—'}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">
                      {variants.length > 0
                        ? variants.map((variant) => variant.size_code).join(', ')
                        : '—'}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => onSelectProfile(profile)}
                          className="rounded-md border border-white/15 px-2 py-1 text-xs font-semibold text-obsidian-ink hover:border-obsidian-accent"
                        >
                          Preview
                        </button>
                        <button
                          type="button"
                          onClick={() => onEditProfile(profile)}
                          className="rounded-md border border-white/15 px-2 py-1 text-xs font-semibold text-obsidian-ink hover:border-emerald-500"
                        >
                          Edit
                        </button>
                        {profile.approximate_fit ? (
                          <span className="rounded-full border border-white/20 px-2 py-1 text-[10px] uppercase tracking-wide text-obsidian-muted">
                            Approximate
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-500/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                            Validated
                          </span>
                        )}
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
