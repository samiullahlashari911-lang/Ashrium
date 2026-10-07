'use client';

import { useEffect, useState } from 'react';

import { AshriumWordmark } from '@/components/brand/ashrium-logo';
import { CaptureFlowMeter } from '@/components/widget/guided-capture/capture-flow-meter';
import { HeightDial } from '@/components/widget/guided-capture/height-dial';
import { WeightDial } from '@/components/widget/guided-capture/weight-dial';
import {
  AGE_ATTESTATION_LABEL,
  CONSENT_BULLETS,
  CONSENT_CHECKBOX_LABEL,
  CONSENT_SUMMARY,
  FACE_ON_DEVICE_BULLET,
  FITTED_CLOTHING_COPY,
  ILLINOIS_BIPA_REFUSAL,
  PRIVACY_PAGE_PATH,
  SEX_WHY_COPY,
  UNDER_16_REFUSAL,
  WEIGHT_WHY_COPY,
} from '@/lib/privacy/consent-copy';
import { shouldBlockIllinoisCapture } from '@/lib/privacy/illinois-bipa';
import {
  consentContinueGuidance,
  isConsentContinueEnabled,
  type ConsentContinueState,
} from '@/lib/widget/consent-gate';
import { HEIGHT_CM_DEFAULT, clampHeightCm } from '@/lib/widget/height-units';
import { WEIGHT_KG_DEFAULT, clampWeightKg } from '@/lib/widget/weight-units';
import type { CaptureSex } from '@/types/hmr';

export interface CaptureIntakeValues {
  heightCm: number;
  sex: CaptureSex;
  weightKg: number | null;
}

interface CaptureIntakeProps {
  onSubmit: (values: CaptureIntakeValues) => void;
  /** Age + privacy passed — start the A100 while height/photos continue. */
  onConsentPassed?: () => void;
  heading?: string;
  submitLabel?: string;
  showStep?: boolean;
  /** Merchant enabled the on-device face: say so before consent. */
  showFaceNotice?: boolean;
}

type IntakePage = 'consent' | 'height' | 'sex' | 'weight';

const PREVIOUS_PAGE: Record<Exclude<IntakePage, 'consent'>, IntakePage> = {
  height: 'consent',
  sex: 'height',
  weight: 'sex',
};

const SEX_OPTIONS: ReadonlyArray<{ value: CaptureSex; label: string; hint: string }> = [
  { value: 'female', label: 'Female', hint: 'Female capture outline' },
  { value: 'male', label: 'Male', hint: 'Male capture outline' },
  { value: 'unspecified', label: 'Prefer not to say', hint: 'Neutral capture outline' },
];

const BULLET_ICONS: ReadonlyArray<string> = [
  // camera with a slash through the face area
  'M4 8h3l2-2.5h6L17 8h3v10H4zM12 10.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6M3 3l18 18',
  // stopwatch
  'M12 8v5l3 2M9 2h6M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16',
  // shield
  'M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6zM8.5 12l2.5 2.5 4.5-5',
  // fitted tee
  'M8 3l-5 3 2 4 2-1v12h10V9l2 1 2-4-5-3c-.5 1.7-2 3-4 3S8.5 4.7 8 3',
];

function BackButton({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Back"
      className="flex h-10 w-10 items-center justify-center rounded-full border border-ash-line bg-ash-surface text-ash-ink transition hover:border-ash-subtle active:scale-95"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
        <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function CheckRow({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-[13px] leading-relaxed text-ash-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={[
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition peer-focus-visible:ring-2 peer-focus-visible:ring-ash-accent/40',
          checked ? 'border-ash-accent bg-ash-accent text-white' : 'border-ash-subtle bg-ash-surface text-transparent',
        ].join(' ')}
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5">
          <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span>{children}</span>
    </label>
  );
}

function PageTitle({ eyebrow, title, children }: {
  eyebrow?: string;
  title: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      {eyebrow ? (
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ash-accent">{eyebrow}</p>
      ) : null}
      <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ash-ink">{title}</h1>
      {children}
    </div>
  );
}

export function CaptureIntake({
  onSubmit,
  onConsentPassed,
  heading = 'Before we start',
  submitLabel = 'Next',
  showStep = true,
  showFaceNotice = false,
}: CaptureIntakeProps): React.JSX.Element {
  const [page, setPage] = useState<IntakePage>('consent');
  const [heightCm, setHeightCm] = useState(HEIGHT_CM_DEFAULT);
  const [heightTouched, setHeightTouched] = useState(false);
  const [sex, setSex] = useState<CaptureSex | null>(null);
  const [showSexWhy, setShowSexWhy] = useState(false);
  const [weightKg, setWeightKg] = useState(WEIGHT_KG_DEFAULT);
  const [weightTouched, setWeightTouched] = useState(false);
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

  const finish = (includeWeight: boolean): void => {
    if (sex === null) {
      setError('Choose an option to continue.');
      setPage('sex');
      return;
    }

    setError(null);
    onSubmit({
      heightCm: clampHeightCm(heightCm),
      sex,
      weightKg: includeWeight ? clampWeightKg(weightKg) : null,
    });
  };

  const advance = (): void => {
    if (page === 'consent') {
      if (!isConsentContinueEnabled({ ageAttested, privacyConsent: consent })) {
        setError(consentHint.message);
        return;
      }
      setError(null);
      setPage('height');
      onConsentPassed?.();
      return;
    }
    if (page === 'height') {
      setError(null);
      setPage('sex');
      return;
    }
    if (page === 'sex') {
      if (sex === null) {
        setError('Choose an option to continue.');
        return;
      }
      setError(null);
      setPage('weight');
      return;
    }
    finish(true);
  };

  const goBack = (): void => {
    if (page === 'consent') {
      return;
    }
    setError(null);
    setPage(PREVIOUS_PAGE[page]);
  };

  if (illinoisBlocked || under16) {
    return (
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col gap-6 px-6 py-8 text-ash-ink">
        <AshriumWordmark markClassName="h-6 w-6 shrink-0 text-ash-accent" wordClassName="text-sm font-semibold tracking-[0.02em]" />
        <div className="ash-page-in flex flex-1 flex-col justify-center gap-4">
          <PageTitle title={illinoisBlocked ? 'Fitting not available' : 'Sorry, you need to be 16 or older'}>
            <p className="text-sm leading-relaxed text-ash-muted">
              {illinoisBlocked ? ILLINOIS_BIPA_REFUSAL : UNDER_16_REFUSAL}
            </p>
          </PageTitle>
          {under16 ? (
            <button type="button" onClick={() => setUnder16(false)} className="ash-cta-secondary self-start">
              I made a mistake
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const ctaReady =
    page === 'consent' ? consentReady
      : page === 'height' ? heightTouched
        : page === 'sex' ? sex !== null
          : weightTouched;

  return (
    <div className="mx-auto flex h-[100dvh] max-h-[100dvh] w-full max-w-md flex-col text-ash-ink">
      <header className="flex shrink-0 flex-col gap-5 px-6 pb-2 pt-6">
        <div className="flex h-10 items-center justify-between">
          {page !== 'consent' ? <BackButton onClick={goBack} /> : <span className="h-10 w-10" />}
          <AshriumWordmark
            markClassName="h-6 w-6 shrink-0 text-ash-accent"
            wordClassName="text-sm font-semibold tracking-[0.02em]"
          />
          <span className="h-10 w-10" />
        </div>
        {showStep ? <CaptureFlowMeter step={page} /> : null}
      </header>

      <div key={page} className="ash-page-in flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pb-6 pt-4">
        {page === 'consent' ? (
          <>
            <PageTitle title={heading}>
              <p className="text-sm leading-relaxed text-ash-muted">
                Your camera stays off until you agree. Here is everything that happens:
              </p>
            </PageTitle>

            <ul className="flex flex-col gap-3.5">
              {(showFaceNotice ? [...CONSENT_BULLETS, FACE_ON_DEVICE_BULLET] : CONSENT_BULLETS).map((bullet, index) => (
                <li key={bullet.title} className="flex items-start gap-3.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ash-accent-soft text-ash-accent">
                    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true">
                      <path d={BULLET_ICONS[index] ?? BULLET_ICONS[0] ?? ''} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-ash-ink">{bullet.title}</span>
                    <span className="text-[13px] leading-relaxed text-ash-muted">{bullet.body}</span>
                  </span>
                </li>
              ))}
            </ul>

            <details className="group text-[13px] text-ash-muted">
              <summary className="cursor-pointer list-none font-semibold text-ash-accent">
                <span className="inline-flex items-center gap-1">
                  Full details
                  <svg viewBox="0 0 24 24" className="h-4 w-4 transition group-open:rotate-180" aria-hidden="true">
                    <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </summary>
              <div className="mt-3 flex flex-col gap-2 leading-relaxed">
                <p>{CONSENT_SUMMARY}</p>
                <p>{FITTED_CLOTHING_COPY}</p>
                <a
                  href={PRIVACY_PAGE_PATH}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-ash-accent underline-offset-2 hover:underline"
                >
                  Read the privacy page
                </a>
              </div>
            </details>

            <button
              type="button"
              onClick={() => {
                setUnder16(true);
                setAgeAttested(false);
                setConsent(false);
              }}
              className="self-start text-xs text-ash-subtle underline-offset-2 hover:underline"
            >
              I am under 16
            </button>
          </>
        ) : null}

        {page === 'height' ? (
          <>
            <PageTitle title="How tall are you?">
              <p className="text-sm leading-relaxed text-ash-muted">
                Your avatar is scaled to this exact height. Scroll or tap to choose.
              </p>
            </PageTitle>
            <div className="flex flex-1 flex-col justify-center">
              <HeightDial
                heightCm={heightCm}
                onChange={setHeightCm}
                onInteract={() => setHeightTouched(true)}
              />
            </div>
          </>
        ) : null}

        {page === 'sex' ? (
          <>
            <PageTitle title="Your body profile">
              <div className="flex items-center gap-2">
                <p className="text-sm leading-relaxed text-ash-muted">Which describes you?</p>
                <button
                  type="button"
                  onClick={() => setShowSexWhy((open) => !open)}
                  aria-expanded={showSexWhy}
                  className="inline-flex items-center gap-1 rounded-full bg-ash-accent-soft px-2.5 py-1 text-xs font-semibold text-ash-accent transition hover:bg-ash-accent/15"
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
                    <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 11v5M12 7.5v.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  Why we ask
                </button>
              </div>
            </PageTitle>
            {showSexWhy ? (
              <p className="ash-rise rounded-2xl bg-ash-accent-soft px-4 py-3 text-[13px] leading-relaxed text-ash-ink">
                {SEX_WHY_COPY}
              </p>
            ) : null}
            <fieldset className="flex flex-col gap-3">
              <legend className="sr-only">Sex</legend>
              {SEX_OPTIONS.map((option) => {
                const selected = sex === option.value;
                return (
                  <label
                    key={option.value}
                    className={[
                      'flex cursor-pointer items-center justify-between gap-4 rounded-2xl border px-5 py-4 transition duration-200 active:scale-[0.99]',
                      selected
                        ? 'border-ash-accent bg-ash-accent-soft shadow-[0_6px_20px_rgba(106,76,245,0.14)]'
                        : 'border-ash-line bg-ash-surface hover:border-ash-subtle',
                    ].join(' ')}
                  >
                    <input
                      type="radio"
                      name="sex"
                      value={option.value}
                      checked={selected}
                      onChange={() => {
                        setSex(option.value);
                        setError(null);
                      }}
                      className="sr-only"
                    />
                    <span className="flex flex-col">
                      <span className="text-[15px] font-semibold text-ash-ink">{option.label}</span>
                      <span className="text-xs text-ash-muted">{option.hint}</span>
                    </span>
                    <span
                      aria-hidden="true"
                      className={[
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition',
                        selected ? 'border-ash-accent bg-ash-accent text-white' : 'border-ash-line text-transparent',
                      ].join(' ')}
                    >
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5">
                        <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          </>
        ) : null}

        {page === 'weight' ? (
          <>
            <PageTitle eyebrow="Optional" title="What do you weigh?">
              <p className="text-sm leading-relaxed text-ash-muted">{WEIGHT_WHY_COPY}</p>
            </PageTitle>
            <div className="flex flex-1 flex-col justify-center">
              <WeightDial
                weightKg={weightKg}
                onChange={setWeightKg}
                onInteract={() => setWeightTouched(true)}
              />
            </div>
          </>
        ) : null}

        {error ? <p role="alert" className="text-sm text-ash-tension">{error}</p> : null}
      </div>

      <footer className="flex shrink-0 flex-col gap-3 border-t border-ash-line/70 bg-ash-canvas px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">
        {page === 'consent' ? (
          <>
            <div className="flex flex-col gap-3 rounded-2xl border border-ash-line bg-ash-surface p-4 shadow-card">
              <CheckRow checked={ageAttested} onChange={setAgeAttested}>
                {AGE_ATTESTATION_LABEL}
              </CheckRow>
              <CheckRow checked={consent} onChange={setConsent}>
                {CONSENT_CHECKBOX_LABEL}
              </CheckRow>
            </div>
            <p id={consentHint.id} role="status" aria-live="polite" className="sr-only">
              {consentHint.message}
            </p>
          </>
        ) : null}
        <div className="flex gap-3">
          {page === 'weight' ? (
            <button type="button" onClick={() => finish(false)} className="ash-cta-secondary flex-1 py-4">
              Skip
            </button>
          ) : null}
          {page === 'consent' ? (
            <button
              type="button"
              onClick={advance}
              disabled={!consentReady}
              aria-describedby={consentHint.id}
              className="ash-cta w-full py-4"
            >
              Agree and continue
            </button>
          ) : ctaReady ? (
            <button
              key={`${page}-next`}
              type="button"
              onClick={advance}
              className="ash-cta ash-rise flex-1 py-4"
            >
              {page === 'weight' ? submitLabel : 'Next'}
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : page !== 'weight' ? (
            <p className="w-full py-4 text-center text-sm text-ash-subtle">
              {page === 'height' ? 'Scroll to your height' : 'Pick one to continue'}
            </p>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
