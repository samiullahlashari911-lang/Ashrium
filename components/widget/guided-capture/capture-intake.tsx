'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { AshriumWordmark } from '@/components/brand/ashrium-logo';
import { obsidianTitanium } from '@/lib/design-tokens';
import {
  AGE_ATTESTATION_LABEL,
  CONSENT_CHECKBOX_LABEL,
  CONSENT_SUMMARY,
  FITTED_CLOTHING_COPY,
  ILLINOIS_BIPA_REFUSAL,
  PRIVACY_PAGE_PATH,
  UNDER_16_REFUSAL,
} from '@/lib/privacy/consent-copy';
import { shouldBlockIllinoisCapture } from '@/lib/privacy/illinois-bipa';
import type { CaptureSex } from '@/types/hmr';

export interface CaptureIntakeValues {
  heightCm: number;
  sex: CaptureSex;
  weightKg: number | null;
}

interface CaptureIntakeProps {
  onSubmit: (values: CaptureIntakeValues) => void;
  heading?: string;
  submitLabel?: string;
  showStep?: boolean;
}

const SEX_OPTIONS: ReadonlyArray<{ value: CaptureSex; label: string }> = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'unspecified', label: 'Unspecified' },
];

function IntakeShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      className="mx-auto flex w-full max-w-md flex-col gap-5 px-6 py-8"
      style={{ color: obsidianTitanium.ink }}
    >
      {children}
    </div>
  );
}

export function CaptureIntake({
  onSubmit,
  heading = 'Your measurements',
  submitLabel = 'Continue to photos',
  showStep = true,
}: CaptureIntakeProps): React.JSX.Element {
  const [heightCm, setHeightCm] = useState('');
  const [sex, setSex] = useState<CaptureSex>('unspecified');
  const [weightKg, setWeightKg] = useState('');
  const [ageAttested, setAgeAttested] = useState(false);
  const [consent, setConsent] = useState(false);
  const [under16, setUnder16] = useState(false);
  const [illinoisBlocked, setIllinoisBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIllinoisBlocked(shouldBlockIllinoisCapture());
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const parsedHeight = Number(heightCm);
    const parsedWeight = weightKg.trim() === '' ? null : Number(weightKg);

    if (!Number.isFinite(parsedHeight) || parsedHeight < 50 || parsedHeight > 250) {
      setError('Enter a height between 50 and 250 cm.');
      return;
    }

    if (
      parsedWeight !== null
      && (!Number.isFinite(parsedWeight) || parsedWeight < 10 || parsedWeight > 400)
    ) {
      setError('Weight is optional. If you add it, use 10–400 kg.');
      return;
    }

    if (!ageAttested) {
      setError('Confirm you are 16 or older before continuing.');
      return;
    }

    if (!consent) {
      setError('Confirm the privacy notice before continuing.');
      return;
    }

    setError(null);
    onSubmit({
      heightCm: parsedHeight,
      sex,
      weightKg: parsedWeight,
    });
  };

  if (illinoisBlocked) {
    return (
      <IntakeShell>
        <AshriumWordmark
          className="mb-2"
          markClassName="h-7 w-7 shrink-0"
          wordClassName="text-sm font-medium tracking-[0.04em]"
        />
        <h1 className="text-2xl font-semibold tracking-tight">Fitting not available</h1>
        <p className="text-sm text-obsidian-muted">{ILLINOIS_BIPA_REFUSAL}</p>
      </IntakeShell>
    );
  }

  if (under16) {
    return (
      <IntakeShell>
        <AshriumWordmark
          className="mb-2"
          markClassName="h-7 w-7 shrink-0"
          wordClassName="text-sm font-medium tracking-[0.04em]"
        />
        <h1 className="text-2xl font-semibold tracking-tight">Under 16</h1>
        <p className="text-sm text-obsidian-muted">{UNDER_16_REFUSAL}</p>
        <button
          type="button"
          onClick={() => setUnder16(false)}
          className="rounded-full border border-white/15 px-4 py-2 text-sm text-obsidian-ink"
        >
          I made a mistake
        </button>
      </IntakeShell>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto flex w-full max-w-md flex-col gap-5 px-6 py-8"
      style={{ color: obsidianTitanium.ink }}
    >
      <header className="flex flex-col gap-2">
        <AshriumWordmark
          className="mb-2"
          markClassName="h-7 w-7 shrink-0"
          wordClassName="text-sm font-medium tracking-[0.04em]"
        />
        {showStep ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-obsidian-subtle">
            Step 1 of 3
          </p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
        <p className="text-sm text-obsidian-muted">
          Height and sex shape the avatar. Weight is optional. The camera stays off until you
          confirm age and consent.
        </p>
        <p className="text-sm text-obsidian-muted">{FITTED_CLOTHING_COPY}</p>
      </header>

      <label className="flex items-start gap-3 text-sm text-obsidian-muted">
        <input
          type="checkbox"
          checked={ageAttested}
          required
          onChange={(event) => setAgeAttested(event.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-obsidian-accent"
        />
        <span>{AGE_ATTESTATION_LABEL}</span>
      </label>
      <p className="text-xs text-obsidian-subtle">{UNDER_16_REFUSAL}</p>
      <button
        type="button"
        onClick={() => {
          setUnder16(true);
          setAgeAttested(false);
          setConsent(false);
          setHeightCm('');
          setWeightKg('');
          setSex('unspecified');
        }}
        className="self-start text-xs text-obsidian-subtle underline-offset-2 hover:underline"
      >
        I am under 16
      </button>

      <label className="flex flex-col gap-2 text-sm">
        <span className="font-medium">Height (cm)</span>
        <input
          type="number"
          inputMode="decimal"
          min={50}
          max={250}
          required
          value={heightCm}
          onChange={(event) => setHeightCm(event.target.value)}
          className="obsidian-input"
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Sex</legend>
        <div className="grid grid-cols-3 gap-2">
          {SEX_OPTIONS.map((option) => {
            const selected = sex === option.value;
            return (
              <label
                key={option.value}
                className={[
                  'cursor-pointer rounded-xl border px-2 py-3 text-center text-sm',
                  selected
                    ? 'border-obsidian-accent bg-obsidian-accent/15 text-obsidian-ink'
                    : 'border-white/10 bg-obsidian-canvas text-obsidian-muted',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name="sex"
                  value={option.value}
                  checked={selected}
                  onChange={() => setSex(option.value)}
                  className="sr-only"
                />
                {option.label}
              </label>
            );
          })}
        </div>
      </fieldset>

      <label className="flex flex-col gap-2 text-sm">
        <span className="font-medium">
          Weight (kg) <span className="font-normal text-obsidian-subtle">optional</span>
        </span>
        <input
          type="number"
          inputMode="decimal"
          min={10}
          max={400}
          value={weightKg}
          onChange={(event) => setWeightKg(event.target.value)}
          className="obsidian-input"
        />
      </label>

      {error ? <p className="text-sm text-rose-300">{error}</p> : null}

      <label className="flex items-start gap-3 text-sm text-obsidian-muted">
        <input
          type="checkbox"
          checked={consent}
          required
          onChange={(event) => setConsent(event.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-obsidian-accent"
        />
        <span>
          {CONSENT_CHECKBOX_LABEL}{' '}
          <a
            href={PRIVACY_PAGE_PATH}
            target="_blank"
            rel="noreferrer"
            className="text-obsidian-accent-muted underline-offset-2 hover:underline"
          >
            Privacy details
          </a>
          . {CONSENT_SUMMARY}
        </span>
      </label>

      <button
        type="submit"
        className="obsidian-cta mt-2"
        disabled={!consent || !ageAttested}
      >
        {submitLabel}
      </button>
    </form>
  );
}
