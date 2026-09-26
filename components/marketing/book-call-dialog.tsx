'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type JSX, type RefObject } from 'react';

import type { LeadField, LeadFieldErrors } from '@/lib/marketing/lead';

interface BookCallDialogProps {
  onClose: () => void;
  open: boolean;
}

const FIELD_ORDER: readonly LeadField[] = [
  'companyName',
  'shopifyStoreUrl',
  'annualRecurringRevenueUsd',
];

type DialogStatus = 'editing' | 'saving' | 'saved';

function isLeadField(value: string): value is LeadField {
  return value === 'companyName' || value === 'shopifyStoreUrl' || value === 'annualRecurringRevenueUsd';
}

export function BookCallDialog({ onClose, open }: BookCallDialogProps): JSX.Element | null {
  const titleId = useId();
  const errorId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const companyRef = useRef<HTMLInputElement>(null);
  const storeRef = useRef<HTMLInputElement>(null);
  const revenueRef = useRef<HTMLInputElement>(null);
  const [companyName, setCompanyName] = useState('');
  const [shopifyStoreUrl, setShopifyStoreUrl] = useState('');
  const [annualRecurringRevenueUsd, setAnnualRecurringRevenueUsd] = useState('');
  const [website, setWebsite] = useState('');
  const [errors, setErrors] = useState<LeadFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<DialogStatus>('editing');
  const [calendlyUrl, setCalendlyUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setCompanyName('');
    setShopifyStoreUrl('');
    setAnnualRecurringRevenueUsd('');
    setWebsite('');
    setErrors({});
    setFormError(null);
    setStatus('editing');
    setCalendlyUrl(null);
  }, [open]);

  useEffect(() => {
    const node = dialogRef.current;
    if (!open || !node) {
      return;
    }

    if (!node.open) {
      node.showModal();
    }

    return () => {
      if (node.open) {
        node.close();
      }
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const fieldRefs: Record<LeadField, RefObject<HTMLInputElement | null>> = {
    companyName: companyRef,
    shopifyStoreUrl: storeRef,
    annualRecurringRevenueUsd: revenueRef,
  };

  function requestClose(): void {
    const dirty = companyName.trim().length > 0
      || shopifyStoreUrl.trim().length > 0
      || annualRecurringRevenueUsd.trim().length > 0;
    if (status === 'editing' && dirty) {
      const leave = window.confirm('Leave this request? What you typed will be cleared.');
      if (!leave) {
        return;
      }
    }
    onClose();
  }

  function focusFirstError(nextErrors: LeadFieldErrors): void {
    const field = FIELD_ORDER.find((key) => nextErrors[key]);
    if (field) {
      fieldRefs[field].current?.focus();
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (status === 'saving') {
      return;
    }

    setStatus('saving');
    setFormError(null);
    setErrors({});

    try {
      const response = await fetch('/api/v1/marketing/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName,
          shopifyStoreUrl,
          annualRecurringRevenueUsd,
          website,
        }),
      });
      const payload: unknown = await response.json();
      const record = typeof payload === 'object' && payload !== null
        ? payload as Record<string, unknown>
        : {};

      if (response.status === 400 && record.code === 'VALIDATION') {
        const nextErrors: LeadFieldErrors = {};
        if (typeof record.errors === 'object' && record.errors !== null) {
          for (const [key, message] of Object.entries(record.errors)) {
            if (isLeadField(key) && typeof message === 'string') {
              nextErrors[key] = message;
            }
          }
        }
        setErrors(nextErrors);
        setStatus('editing');
        focusFirstError(nextErrors);
        return;
      }

      if (response.status === 429) {
        setFormError('Too many requests. Wait a minute and try again.');
        setStatus('editing');
        return;
      }

      if (!response.ok) {
        const message = typeof record.message === 'string'
          ? record.message
          : 'We could not save this request. Try again in a moment.';
        setFormError(message);
        setStatus('editing');
        return;
      }

      setCalendlyUrl(typeof record.calendlyUrl === 'string' ? record.calendlyUrl : null);
      setStatus('saved');
    } catch {
      setFormError('We could not save this request. Check your connection and try again.');
      setStatus('editing');
    }
  }

  const saving = status === 'saving';

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="marketing-dialog"
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
    >
      <div className="relative max-h-[inherit] overflow-y-auto rounded-[1.75rem] border border-white/10 bg-obsidian-card p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-balance text-2xl font-semibold tracking-tight">
            {status === 'saved' ? 'Choose a time' : 'Book a Call'}
          </h2>
          <button
            type="button"
            className="rounded-full border border-white/15 px-3 py-1.5 text-sm text-obsidian-muted transition-colors duration-150 hover:text-obsidian-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            onClick={requestClose}
          >
            Close
          </button>
        </div>

        {status === 'saved' ? (
          <div className="mt-5">
            <p className="max-w-prose text-pretty text-sm text-obsidian-muted">
              {calendlyUrl
                ? 'Request saved. Pick a time and Calendly will email the invite.'
                : 'Request saved. The calendar is not connected on this deployment, so a time cannot be picked here yet.'}
            </p>
            {calendlyUrl ? (
              <iframe
                title="Choose a time to book a call"
                src={calendlyUrl}
                className="mt-4 h-[min(40rem,70dvh)] w-full rounded-2xl border border-white/10 bg-white"
              />
            ) : null}
          </div>
        ) : (
          <form className="mt-5 space-y-4" noValidate onSubmit={(event) => { void onSubmit(event); }}>
            <p
              id={errorId}
              aria-live="polite"
              className={formError ? 'text-sm text-obsidian-tension' : 'sr-only'}
            >
              {formError ?? ''}
            </p>

            <div className="pointer-events-none absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden="true">
              <label htmlFor="marketing-website">Website</label>
              <input
                id="marketing-website"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
              />
            </div>

            <Field
              id="marketing-company"
              name="companyName"
              label="Company name"
              autoComplete="organization"
              placeholder="Northwind Apparel…"
              value={companyName}
              error={errors.companyName}
              inputRef={companyRef}
              onChange={setCompanyName}
            />
            <Field
              id="marketing-store"
              name="shopifyStoreUrl"
              label="Shopify store link"
              type="url"
              inputMode="url"
              autoComplete="url"
              spellCheck={false}
              placeholder="https://your-store.myshopify.com…"
              value={shopifyStoreUrl}
              error={errors.shopifyStoreUrl}
              inputRef={storeRef}
              onChange={setShopifyStoreUrl}
            />
            <Field
              id="marketing-revenue"
              name="annualRecurringRevenueUsd"
              label="Annual recurring revenue (USD)"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              placeholder="1200000…"
              value={annualRecurringRevenueUsd}
              error={errors.annualRecurringRevenueUsd}
              inputRef={revenueRef}
              onChange={setAnnualRecurringRevenueUsd}
            />

            <button type="submit" className="obsidian-cta w-full" disabled={saving}>
              {saving ? 'Sending…' : 'Book a Call'}
            </button>
          </form>
        )}
      </div>
    </dialog>
  );
}

interface FieldProps {
  autoComplete: string;
  error?: string;
  id: string;
  inputMode?: 'decimal' | 'url';
  inputRef: RefObject<HTMLInputElement | null>;
  label: string;
  name: string;
  onChange: (value: string) => void;
  placeholder: string;
  spellCheck?: boolean;
  type?: 'text' | 'url';
  value: string;
}

function Field({
  autoComplete,
  error,
  id,
  inputMode,
  inputRef,
  label,
  name,
  onChange,
  placeholder,
  spellCheck,
  type = 'text',
  value,
}: FieldProps): JSX.Element {
  const errorId = `${id}-error`;

  return (
    <div>
      <label htmlFor={id} className="text-sm text-obsidian-ink">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        name={name}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
        placeholder={placeholder}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="obsidian-input mt-1.5"
      />
      {error ? (
        <p id={errorId} className="mt-1.5 text-sm text-obsidian-tension">
          {error}
        </p>
      ) : null}
    </div>
  );
}
