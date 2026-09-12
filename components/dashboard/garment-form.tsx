'use client';

import { useEffect, useState, useTransition, type FC, type FormEvent } from 'react';

import {
  createGarmentProfile,
  updateGarmentProfile,
  type GarmentFormInput,
  type GarmentSizeFormInput,
} from '@/lib/server/garments';
import { DEFAULT_LETTER_SIZE_CHART } from '@/lib/fit/size-recommend';
import { formatComposition, GARMENT_CATEGORIES, readGarmentComposition } from '@/types/garment';
import type { GarmentCadProfileRow, GarmentSizeVariantRow } from '@/types/database';

export const DEFAULT_MECHANICAL_PROPERTIES: GarmentFormInput = {
  sku: '',
  name: '',
  tensileStiffness: 1.0,
  bendingRigidity: 0.1,
  shearStiffness: 0.5,
  areaDensity: 0.2,
  cadPatternUrl: '',
  category: '',
  compositionText: '',
  gsm: '',
  sizeVariants: [],
};

export interface GarmentFormProps {
  editingProfile: GarmentCadProfileRow | null;
  editingVariants: GarmentSizeVariantRow[];
  onSaved: () => void;
  onCancelEdit: () => void;
}

function variantsToForm(variants: GarmentSizeVariantRow[]): GarmentSizeFormInput[] {
  return variants.map((variant) => ({
    sizeCode: variant.size_code,
    chestCm: variant.chest_cm ?? 0,
    waistCm: variant.waist_cm ?? 0,
    hipCm: variant.hip_cm ?? 0,
    lengthCm: variant.length_cm ?? 0,
    externalSku: variant.external_sku ?? '',
  }));
}

function profileToFormInput(
  profile: GarmentCadProfileRow,
  variants: GarmentSizeVariantRow[],
): GarmentFormInput {
  const category = GARMENT_CATEGORIES.includes(profile.category as (typeof GARMENT_CATEGORIES)[number])
    ? (profile.category as GarmentFormInput['category'])
    : '';

  return {
    sku: profile.sku,
    name: profile.name,
    tensileStiffness: profile.tensile_stiffness,
    bendingRigidity: profile.bending_rigidity,
    shearStiffness: profile.shear_stiffness,
    areaDensity: profile.area_density,
    cadPatternUrl: profile.cad_pattern_url ?? '',
    category,
    compositionText: formatComposition(readGarmentComposition(profile.composition)),
    gsm: profile.gsm ?? '',
    sizeVariants: variantsToForm(variants),
  };
}

const EMPTY_SIZE: GarmentSizeFormInput = {
  sizeCode: '',
  chestCm: 0,
  waistCm: 0,
  hipCm: 0,
  lengthCm: 0,
  externalSku: '',
};

export const GarmentForm: FC<GarmentFormProps> = ({
  editingProfile,
  editingVariants,
  onSaved,
  onCancelEdit,
}) => {
  const [formValues, setFormValues] = useState<GarmentFormInput>(
    editingProfile
      ? profileToFormInput(editingProfile, editingVariants)
      : DEFAULT_MECHANICAL_PROPERTIES,
  );
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [isError, setIsError] = useState<boolean>(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setFormValues(
      editingProfile
        ? profileToFormInput(editingProfile, editingVariants)
        : DEFAULT_MECHANICAL_PROPERTIES,
    );
    setStatusMessage('');
    setIsError(false);
  }, [editingProfile, editingVariants]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setStatusMessage('');
    setIsError(false);

    startTransition(async () => {
      const result = editingProfile
        ? await updateGarmentProfile(editingProfile.id, formValues)
        : await createGarmentProfile(formValues);

      setStatusMessage(result.message);
      setIsError(!result.success);

      if (result.success) {
        setFormValues(DEFAULT_MECHANICAL_PROPERTIES);
        onSaved();
      }
    });
  };

  const updateField = <K extends keyof GarmentFormInput>(
    field: K,
    value: GarmentFormInput[K],
  ): void => {
    setFormValues((current) => ({ ...current, [field]: value }));
  };

  const updateSize = (index: number, patch: Partial<GarmentSizeFormInput>): void => {
    setFormValues((current) => ({
      ...current,
      sizeVariants: current.sizeVariants.map((variant, cursor) =>
        cursor === index ? { ...variant, ...patch } : variant,
      ),
    }));
  };

  return (
    <form onSubmit={handleSubmit} className="obsidian-glass p-5">
      <header className="mb-4 border-b border-white/10 pb-3">
        <h2 className="text-lg font-semibold text-obsidian-ink">
          {editingProfile ? 'Edit CAD garment profile' : 'New CAD garment profile'}
        </h2>
        <p className="text-sm text-obsidian-muted">
          Composition and GSM map to KES mechanical targets. Size rows are Laplacian-graded on save.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-obsidian-muted">
          SKU
          <input
            required
            value={formValues.sku}
            onChange={(event) => updateField('sku', event.target.value)}
            className="obsidian-input-box"
            placeholder="GAR-001"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-obsidian-muted">
          Name
          <input
            required
            value={formValues.name}
            onChange={(event) => updateField('name', event.target.value)}
            className="obsidian-input-box"
            placeholder="Merino Wool Tee"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-obsidian-muted">
          Category
          <select
            value={formValues.category}
            onChange={(event) =>
              updateField('category', event.target.value as GarmentFormInput['category'])
            }
            className="obsidian-input-box"
          >
            <option value="">Unspecified</option>
            {GARMENT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-obsidian-muted">
          GSM
          <input
            type="number"
            min="40"
            max="800"
            step="1"
            value={formValues.gsm}
            onChange={(event) =>
              updateField('gsm', event.target.value === '' ? '' : Number(event.target.value))
            }
            className="obsidian-input-box"
            placeholder="180"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-obsidian-muted md:col-span-2">
          Composition
          <input
            value={formValues.compositionText}
            onChange={(event) => updateField('compositionText', event.target.value)}
            className="obsidian-input-box"
            placeholder="95% cotton, 5% elastane"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-obsidian-muted">
          Tensile stiffness S_t (N/m)
          <input
            required
            type="number"
            step="0.01"
            min="0"
            value={formValues.tensileStiffness}
            onChange={(event) => updateField('tensileStiffness', Number(event.target.value))}
            className="obsidian-input-box"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-obsidian-muted">
          Bending rigidity B_r (N*m)
          <input
            required
            type="number"
            step="0.01"
            min="0"
            value={formValues.bendingRigidity}
            onChange={(event) => updateField('bendingRigidity', Number(event.target.value))}
            className="obsidian-input-box"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-obsidian-muted">
          Shear stiffness S_s (N/m)
          <input
            required
            type="number"
            step="0.01"
            min="0"
            value={formValues.shearStiffness}
            onChange={(event) => updateField('shearStiffness', Number(event.target.value))}
            className="obsidian-input-box"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-obsidian-muted">
          Area density rho_a (kg/m^2)
          <input
            required
            type="number"
            step="0.01"
            min="0"
            value={formValues.areaDensity}
            onChange={(event) => updateField('areaDensity', Number(event.target.value))}
            className="obsidian-input-box"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-obsidian-muted md:col-span-2">
          CAD pattern URL
          <input
            type="url"
            value={formValues.cadPatternUrl}
            onChange={(event) => updateField('cadPatternUrl', event.target.value)}
            className="obsidian-input-box"
            placeholder="https://cdn.example.com/patterns/tee-fabric.png"
          />
        </label>
      </div>

      <div className="mt-5 border-t border-white/10 pt-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-obsidian-ink">Size variants</h3>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() =>
                updateField(
                  'sizeVariants',
                  DEFAULT_LETTER_SIZE_CHART.map((size) => ({
                    sizeCode: size.sizeCode,
                    chestCm: size.chestCm,
                    waistCm: size.waistCm,
                    hipCm: size.hipCm,
                    lengthCm: size.lengthCm,
                    externalSku: '',
                  })),
                )
              }
              className="rounded-md border border-white/15 px-2 py-1 text-xs font-semibold text-obsidian-ink hover:border-obsidian-accent"
            >
              Add S–XL chart
            </button>
            <button
              type="button"
              onClick={() => updateField('sizeVariants', [...formValues.sizeVariants, EMPTY_SIZE])}
              className="rounded-md border border-white/15 px-2 py-1 text-xs font-semibold text-obsidian-ink hover:border-obsidian-accent"
            >
              Add size
            </button>
          </div>
        </div>

        {formValues.sizeVariants.length === 0 ? (
          <p className="text-sm text-obsidian-muted">No size variants yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {formValues.sizeVariants.map((variant, index) => (
              <div key={`size-${index}`} className="grid grid-cols-2 gap-2 md:grid-cols-6">
                <input
                  required
                  value={variant.sizeCode}
                  onChange={(event) => updateSize(index, { sizeCode: event.target.value })}
                  className="obsidian-input-box"
                  placeholder="M"
                />
                <input
                  required
                  type="number"
                  min="1"
                  step="0.1"
                  value={variant.chestCm || ''}
                  onChange={(event) => updateSize(index, { chestCm: Number(event.target.value) })}
                  className="obsidian-input-box"
                  placeholder="Chest cm"
                />
                <input
                  required
                  type="number"
                  min="1"
                  step="0.1"
                  value={variant.waistCm || ''}
                  onChange={(event) => updateSize(index, { waistCm: Number(event.target.value) })}
                  className="obsidian-input-box"
                  placeholder="Waist cm"
                />
                <input
                  required
                  type="number"
                  min="1"
                  step="0.1"
                  value={variant.hipCm || ''}
                  onChange={(event) => updateSize(index, { hipCm: Number(event.target.value) })}
                  className="obsidian-input-box"
                  placeholder="Hip cm"
                />
                <input
                  required
                  type="number"
                  min="1"
                  step="0.1"
                  value={variant.lengthCm || ''}
                  onChange={(event) => updateSize(index, { lengthCm: Number(event.target.value) })}
                  className="obsidian-input-box"
                  placeholder="Length cm"
                />
                <button
                  type="button"
                  onClick={() =>
                    updateField(
                      'sizeVariants',
                      formValues.sizeVariants.filter((_, cursor) => cursor !== index),
                    )
                  }
                  className="rounded-md border border-red-900/60 px-2 py-1 text-xs font-semibold text-red-300 hover:border-red-500"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {statusMessage ? (
        <p className={`mt-4 text-sm ${isError ? 'text-red-400' : 'text-emerald-400'}`}>
          {statusMessage}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-3">
        <button type="submit" disabled={isPending} className="obsidian-cta disabled:cursor-not-allowed">
          {isPending ? 'Saving...' : editingProfile ? 'Update profile' : 'Create profile'}
        </button>

        {editingProfile ? (
          <button
            type="button"
            onClick={onCancelEdit}
            className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-obsidian-ink transition hover:border-white/30"
          >
            Cancel edit
          </button>
        ) : null}
      </div>
    </form>
  );
};
