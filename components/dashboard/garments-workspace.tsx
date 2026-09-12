'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FC } from 'react';

import { CatalogSyncBar } from '@/components/dashboard/catalog-sync-bar';
import { EmptyState } from '@/components/dashboard/empty-state';
import { GarmentForm } from '@/components/dashboard/garment-form';
import { GarmentTable } from '@/components/dashboard/garment-table';
import type { GarmentCadProfileRow, GarmentSizeVariantRow, GarmentWorkspaceItem } from '@/types/database';

export interface GarmentsWorkspaceProps {
  initialItems: GarmentWorkspaceItem[];
  shopifyConnected: boolean;
  shopDomain: string | null;
}

export const GarmentsWorkspace: FC<GarmentsWorkspaceProps> = ({
  initialItems,
  shopifyConnected,
  shopDomain,
}) => {
  const router = useRouter();
  const [items, setItems] = useState<GarmentWorkspaceItem[]>(initialItems);
  const [selectedProfile, setSelectedProfile] = useState<GarmentCadProfileRow | null>(
    initialItems[0]?.profile ?? null,
  );
  const [editingProfile, setEditingProfile] = useState<GarmentCadProfileRow | null>(null);

  useEffect(() => {
    setItems(initialItems);

    if (initialItems.length === 0) {
      setSelectedProfile(null);
      return;
    }

    setSelectedProfile((current) => {
      if (!current) {
        return initialItems[0].profile;
      }

      const stillExists = initialItems.some((item) => item.profile.id === current.id);
      return stillExists ? current : initialItems[0].profile;
    });
  }, [initialItems]);

  const variantsByGarmentId = useMemo(() => {
    const map: Record<string, GarmentSizeVariantRow[]> = {};
    for (const item of items) {
      map[item.profile.id] = item.variants;
    }
    return map;
  }, [items]);

  const selectedVariants = selectedProfile ? variantsByGarmentId[selectedProfile.id] ?? [] : [];
  const editingVariants = editingProfile ? variantsByGarmentId[editingProfile.id] ?? [] : [];

  const refreshProfiles = (): void => {
    router.refresh();
    setEditingProfile(null);
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold text-obsidian-ink">CAD garment manager</h1>
        <p className="mt-1 text-sm text-obsidian-muted">
          Test one Shopify SKU, review ingest tier / GSM / composition, and keep charts honest.
        </p>
      </header>

      <CatalogSyncBar connected={shopifyConnected} shopDomain={shopDomain} />

      {items.length === 0 ? (
        <EmptyState
          title="No garments ingested yet"
          description={
            shopifyConnected
              ? 'Paste a product URL, ID, or SKU above to ingest one item. Full catalog sync is optional.'
              : 'Connect Shopify in Settings → Integrations (shop domain + Admin token), then test one SKU. There is no mock catalog.'
          }
          action={
            shopifyConnected
              ? undefined
              : { href: '/settings/integrations', label: 'Open Integrations' }
          }
        />
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="flex flex-col gap-6">
          <GarmentForm
            editingProfile={editingProfile}
            editingVariants={editingVariants}
            onSaved={refreshProfiles}
            onCancelEdit={() => setEditingProfile(null)}
          />
          <GarmentTable
            profiles={items.map((item) => item.profile)}
            variantsByGarmentId={variantsByGarmentId}
            selectedProfileId={selectedProfile?.id ?? null}
            onSelectProfile={setSelectedProfile}
            onEditProfile={setEditingProfile}
            onDeleted={refreshProfiles}
          />
          <section className="obsidian-glass p-5">
            <h2 className="text-lg font-semibold text-obsidian-ink">Selected size variants</h2>
            {selectedProfile && selectedVariants.length > 0 ? (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-left text-sm text-obsidian-ink">
                  <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-obsidian-muted">
                    <tr>
                      <th className="px-2 py-2">Size</th>
                      <th className="px-2 py-2">Chest</th>
                      <th className="px-2 py-2">Waist</th>
                      <th className="px-2 py-2">Hip</th>
                      <th className="px-2 py-2">Length</th>
                      <th className="px-2 py-2">SKU</th>
                      <th className="px-2 py-2">Rest lengths</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedVariants.map((variant) => (
                      <tr key={variant.id} className="border-b border-white/10">
                        <td className="px-2 py-2 font-mono text-xs">{variant.size_code}</td>
                        <td className="px-2 py-2">{variant.chest_cm && variant.chest_cm > 0 ? variant.chest_cm.toFixed(1) : '—'}</td>
                        <td className="px-2 py-2">{variant.waist_cm && variant.waist_cm > 0 ? variant.waist_cm.toFixed(1) : '—'}</td>
                        <td className="px-2 py-2">{variant.hip_cm && variant.hip_cm > 0 ? variant.hip_cm.toFixed(1) : '—'}</td>
                        <td className="px-2 py-2">{variant.length_cm && variant.length_cm > 0 ? variant.length_cm.toFixed(1) : '—'}</td>
                        <td className="px-2 py-2 font-mono text-xs">{variant.external_sku ?? '—'}</td>
                        <td className="px-2 py-2 text-xs text-obsidian-muted">
                          {variant.rest_length_path ? 'GarmentCode' : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-2 text-sm text-obsidian-muted">
                {selectedProfile
                  ? 'This garment has no size variants yet.'
                  : 'Select a garment to inspect size variants.'}
              </p>
            )}
          </section>
        </div>

        <section className="obsidian-glass relative min-h-[320px] p-5">
          <h2 className="text-lg font-semibold text-obsidian-ink">Product image</h2>
          <p className="text-sm text-obsidian-muted">
            {selectedProfile
              ? `${selectedProfile.name} (${selectedProfile.sku})`
              : 'Select a garment'}
          </p>
          {selectedProfile?.cad_pattern_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selectedProfile.cad_pattern_url}
              alt={selectedProfile.name}
              className="mt-4 max-h-[420px] w-full rounded-2xl object-contain"
            />
          ) : (
            <div className="mt-4 flex h-[240px] items-center justify-center rounded-2xl bg-obsidian-canvas/60 text-sm text-obsidian-subtle">
              No product image yet
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
