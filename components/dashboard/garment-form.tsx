'use client';

import { useEffect, useState, useTransition, type FC, type FormEvent } from 'react';

import {
  createGarmentProfile,
  updateGarmentProfile,
  type GarmentFormInput,
} from '@/lib/server/garments';
import type { GarmentCadProfileRow } from '@/types/database';

export const DEFAULT_MECHANICAL_PROPERTIES: GarmentFormInput = {
  sku: '',
  name: '',
  tensileStiffness: 1.0,
  bendingRigidity: 0.1,
  shearStiffness: 0.5,
  areaDensity: 0.2,
  cadPatternUrl: '',
};

export interface GarmentFormProps {
  editingProfile: GarmentCadProfileRow | null;
  onSaved: () => void;
  onCancelEdit: () => void;
}

function profileToFormInput(profile: GarmentCadProfileRow): GarmentFormInput {
  return {
    sku: profile.sku,
    name: profile.name,
    tensileStiffness: profile.tensile_stiffness,
    bendingRigidity: profile.bending_rigidity,
    shearStiffness: profile.shear_stiffness,
    areaDensity: profile.area_density,
    cadPatternUrl: profile.cad_pattern_url ?? '',
  };
}

export const GarmentForm: FC<GarmentFormProps> = ({
  editingProfile,
  onSaved,
  onCancelEdit,
}) => {
  const [formValues, setFormValues] = useState<GarmentFormInput>(
    editingProfile ? profileToFormInput(editingProfile) : DEFAULT_MECHANICAL_PROPERTIES,
  );
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [isError, setIsError] = useState<boolean>(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setFormValues(editingProfile ? profileToFormInput(editingProfile) : DEFAULT_MECHANICAL_PROPERTIES);
    setStatusMessage('');
    setIsError(false);
  }, [editingProfile]);

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

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg"
    >
      <header className="mb-4 border-b border-slate-800 pb-3">
        <h2 className="text-lg font-semibold text-slate-100">
          {editingProfile ? 'Edit CAD Garment Profile' : 'New CAD Garment Profile'}
        </h2>
        <p className="text-sm text-slate-400">
          Mechanical properties drive PBD draping and strain heatmaps.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          SKU
          <input
            required
            value={formValues.sku}
            onChange={(event) => updateField('sku', event.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            placeholder="GAR-001"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Name
          <input
            required
            value={formValues.name}
            onChange={(event) => updateField('name', event.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            placeholder="Merino Wool Tee"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Tensile Stiffness S_t (N/m)
          <input
            required
            type="number"
            step="0.01"
            min="0"
            value={formValues.tensileStiffness}
            onChange={(event) => updateField('tensileStiffness', Number(event.target.value))}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Bending Rigidity B_r (N*m)
          <input
            required
            type="number"
            step="0.01"
            min="0"
            value={formValues.bendingRigidity}
            onChange={(event) => updateField('bendingRigidity', Number(event.target.value))}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Shear Stiffness S_s (N/m)
          <input
            required
            type="number"
            step="0.01"
            min="0"
            value={formValues.shearStiffness}
            onChange={(event) => updateField('shearStiffness', Number(event.target.value))}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Area Density rho_a (kg/m^2)
          <input
            required
            type="number"
            step="0.01"
            min="0"
            value={formValues.areaDensity}
            onChange={(event) => updateField('areaDensity', Number(event.target.value))}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-300 md:col-span-2">
          CAD Pattern URL
          <input
            required
            type="url"
            value={formValues.cadPatternUrl}
            onChange={(event) => updateField('cadPatternUrl', event.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            placeholder="https://cdn.example.com/patterns/tee-fabric.png"
          />
        </label>
      </div>

      {statusMessage ? (
        <p className={`mt-4 text-sm ${isError ? 'text-red-400' : 'text-emerald-400'}`}>
          {statusMessage}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Saving...' : editingProfile ? 'Update Profile' : 'Create Profile'}
        </button>

        {editingProfile ? (
          <button
            type="button"
            onClick={onCancelEdit}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-500"
          >
            Cancel Edit
          </button>
        ) : null}
      </div>
    </form>
  );
};
