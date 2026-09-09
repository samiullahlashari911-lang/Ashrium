'use client';

import { useEffect, useState, type KeyboardEvent } from 'react';

import { AshriumWordmark } from '@/components/brand/ashrium-logo';
import { CaptureFlowMeter } from '@/components/widget/guided-capture/capture-flow-meter';
import { HeightDial } from '@/components/widget/guided-capture/height-dial';
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
import type { CaptureFlowStep } from '@/lib/widget/capture-progress';
import {
  consentContinueGuidance,
  isConsentContinueEnabled,
  type ConsentContinueState,
} from '@/lib/widget/consent-gate';
import { HEIGHT_CM_DEFAULT, clampHeightCm } from '@/lib/widget/height-units';
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

type IntakePage = 'consent' | 'height' | 'profile';

function intakeStep(page: IntakePage): CaptureFlowStep {
  return page;
}

function IntakeShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      className="mx-auto flex min-h-[420px] w-full max-w-md flex-col gap-5 px-6 py-8"
      style={{ color: obsidianTitanium.ink }}
    >
      {children}
    </div>
  );
}

function NextCircleButton({
  onClick,
  label,
  highlighted,
  describedBy,
}: {
  onClick: () => void;
  label: string;
  highlighted: boolean;
  describedBy?: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-describedby={describedBy}
      className={[
        'flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white shadow-[0_12px_32px_rgba(106,50,201,0.35)] transition',
        highlighted
          ? 'bg-gradient-to-br from-obsidian-accent to-obsidian-accent-end'
          : 'bg-white/10 text-obsidian-muted',
      ].join(' ')}
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
        <path
          d="M8 5l8 7-8 7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

export function CaptureIntake({
  onSubmit,
  heading = 'Before we start',
  submitLabel = 'Next',
  showStep = true,
}: CaptureIntakeProps): React.JSX.Element {
  const [page, setPage] = useState<IntakePage>('consent');
  const [heightCm, setHeightCm] = useState(HEIGHT_CM_DEFAULT);
  const [sex, setSex] = useState<CaptureSex | null>(null);
  const [weightKg, setWeightKg] = useState('');
  const [ageAttested, setAgeAttested] = useState(false);
  const [consent, setConsent] = useState(false);
  const [under16, setUnder16] = useState(false);
  const [illinoisBlocked, setIllinoisBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIllinoisBlocked(shouldBlockIllinoisCapture());
  }, []);

  const consentState: ConsentContinueState = {
    ageAttested,
    privacyConsent: consent,
  };
  const consentReady = isConsentContinueEnabled(consentState);
  const consentHint = consentContinueGuidance(consentState);

  const finish = (): void => {
    const parsedHeight = clampHeightCm(heightCm);
    const parsedWeight = weightKg.trim() === '' ? null : Number(weightKg);

    if (parsedHeight < 50 || parsedHeight > 250) {
      setError('Scroll to a height between 50 and 250 cm.');
      setPage('height');
      return;
    }

    if (
      parsedWeight !== null
      && (!Number.isFinite(parsedWeight) || parsedWeight < 10 || parsedWeight > 400)
    ) {
      setError('Weight is optional. If you add it, use 10–400 kg.');
      setPage('profile');
      return;
    }

    if (sex === null) {
      setError('Choose female, male, or unspecified to continue.');
      setPage('profile');
      return;
    }

    setError(null);
    onSubmit({
      heightCm: parsedHeight,
      sex,
      weightKg: parsedWeight,
    });
  };

  const goHeight = (): void => {
    if (!isConsentContinueEnabled({ ageAttested, privacyConsent: consent })) {
      setError(
        !ageAttested
          ? 'Confirm you are 16 or older before continuing.'
          : 'Confirm the privacy notice before continuing.',
      );
      return;
    }

    setError(null);
    setPage('height');
  };

  const goProfile = (): void => {
    setError(null);
    setPage('profile');
  };

  const advance = (): void => {
    if (page === 'consent') {
      goHeight();
      return;
    }
    if (page === 'height') {
      goProfile();
      return;
    }
    finish();
  };

  const handleWeightEnter = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    advance();
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
    <div
      className="mx-auto flex h-[100dvh] max-h-[100dvh] w-full max-w-md flex-col px-6 pt-8"
      style={{ color: obsidianTitanium.ink }}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pb-4">
        <header className="flex flex-col gap-2">
          <AshriumWordmark
            className="mb-2"
            markClassName="h-7 w-7 shrink-0"
            wordClassName="text-sm font-medium tracking-[0.04em]"
          />
          {showStep ? <CaptureFlowMeter step={intakeStep(page)} /> : null}
          <h1 className="text-2xl font-semibold tracking-tight">
            {page === 'consent'
              ? heading
              : page === 'height'
                ? 'Your height'
                : 'About you'}
          </h1>
          <p className="text-sm text-obsidian-muted">
            {page === 'consent'
              ? 'Age and consent come first. The camera stays off until you continue.'
              : page === 'height'
                ? 'Scroll the dial to your height. Next sits on the right — no extra scrolling.'
                : 'Choose a sex. Optional weight and Next appear beside your choice.'}
          </p>
          {page === 'consent' ? (
            <p className="text-sm text-obsidian-muted">{FITTED_CLOTHING_COPY}</p>
          ) : null}
        </header>

        {page === 'consent' ? (
          <>
            <label className="flex items-start gap-3 text-sm text-obsidian-muted">
              <input
                type="checkbox"
                checked={ageAttested}
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
              }}
              className="self-start text-xs text-obsidian-subtle underline-offset-2 hover:underline"
            >
              I am under 16
            </button>
            <label className="flex items-start gap-3 text-sm text-obsidian-muted">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                className="mt-1 h-4 w-4 shrink-0 accent-obsidian-accent"
              />
              <span>
                {CONSENT_CHECKBOX_LABEL} {CONSENT_SUMMARY}{' '}
                <a
                  href={PRIVACY_PAGE_PATH}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => event.stopPropagation()}
                  className="text-obsidian-accent-muted underline-offset-2 hover:underline"
                >
                  Privacy details
                </a>
              </span>
            </label>
          </>
        ) : null}

        {page === 'height' ? (
          <HeightDial
            heightCm={heightCm}
            onChange={setHeightCm}
            action={
              <NextCircleButton
                onClick={advance}
                label="Next"
                highlighted
              />
            }
          />
        ) : null}

        {page === 'profile' ? (
          <div className="flex items-stretch gap-4">
            <fieldset className="flex min-w-0 flex-1 flex-col gap-2">
              <legend className="sr-only">Sex</legend>
              {SEX_OPTIONS.map((option) => {
                const selected = sex === option.value;
                return (
                  <label
                    key={option.value}
                    className={[
                      'cursor-pointer rounded-2xl border px-4 py-3 text-sm font-medium',
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
            </fieldset>
            {sex !== null ? (
              <div className="flex w-[42%] shrink-0 flex-col justify-between gap-3">
                <label className="flex flex-col gap-2 text-sm">
                  <span className="font-medium">
                    Weight <span className="font-normal text-obsidian-subtle">optional</span>
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={10}
                    max={400}
                    placeholder="kg"
                    value={weightKg}
                    onChange={(event) => setWeightKg(event.target.value)}
                    onKeyDown={handleWeightEnter}
                    className="obsidian-input px-3"
                  />
                </label>
                <button
                  type="button"
                  onClick={advance}
                  className="obsidian-cta w-full"
                >
                  {submitLabel}
                </button>
              </div>
            ) : (
              <p className="w-[42%] shrink-0 self-center text-sm text-obsidian-subtle">
                Pick a row and Next will light up here.
              </p>
            )}
          </div>
        ) : null}

        {error ? <p className="text-sm text-rose-300">{error}</p> : null}

        {page === 'consent' ? (
          <p
            id={consentHint.id}
            role="status"
            aria-live="polite"
            className={consentHint.ready ? 'text-sm text-obsidian-muted' : 'text-sm text-amber-200/90'}
          >
            {consentHint.message}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col gap-3 bg-[#0B0B1E] py-4">
        {page !== 'consent' ? (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setPage(page === 'profile' ? 'height' : 'consent');
            }}
            className="rounded-full border border-white/15 px-4 py-2 text-sm text-obsidian-muted"
          >
            Back
          </button>
        ) : null}
        {page === 'consent' ? (
          <button
            type="button"
            onClick={advance}
            className={['obsidian-cta w-full', !consentReady ? 'opacity-80' : ''].join(' ')}
            aria-disabled={!consentReady}
            aria-describedby={consentHint.id}
          >
            Next
          </button>
        ) : null}
      </div>
    </div>
  );
}
