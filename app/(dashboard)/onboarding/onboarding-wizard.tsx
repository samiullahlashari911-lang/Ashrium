'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent, type ReactNode } from 'react';

import { DomainAllowlistForm } from '@/components/settings/domain-allowlist-form';
import { updateTenantCompanyName } from '@/lib/server/tenant-settings';

export interface OnboardingWizardProps {
  companyName: string;
  garmentCount: number;
  initialDomains: string[];
  platformUrl: string;
  shopDomain: string | null;
  shopifyConnected: boolean;
}

interface StepShellProps {
  children: ReactNode;
  complete: boolean;
  description: string;
  index: number;
  title: string;
}

function StepShell({
  children,
  complete,
  description,
  index,
  title,
}: StepShellProps): React.JSX.Element {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={[
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-sm tabular-nums',
            complete
              ? 'bg-emerald-500/20 text-emerald-200'
              : 'border border-white/15 text-obsidian-muted',
          ].join(' ')}
          aria-hidden="true"
        >
          {complete ? '✓' : index}
        </span>
        <div>
          <h2 className="text-xl font-semibold text-obsidian-ink">{title}</h2>
          <p className="text-sm text-obsidian-muted">{description}</p>
        </div>
        <span
          className={[
            'ml-auto rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em]',
            complete
              ? 'bg-emerald-500/15 text-emerald-200'
              : 'border border-white/15 text-obsidian-subtle',
          ].join(' ')}
        >
          {complete ? 'Done' : 'Pending'}
        </span>
      </div>
      {children}
    </section>
  );
}

export function OnboardingWizard({
  companyName,
  garmentCount,
  initialDomains,
  platformUrl,
  shopDomain,
  shopifyConnected,
}: OnboardingWizardProps): React.JSX.Element {
  const router = useRouter();
  const [name, setName] = useState(companyName);
  const [savedName, setSavedName] = useState(companyName);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [isPending, startTransition] = useTransition();

  const domainsComplete = initialDomains.length > 0;
  const companyComplete = savedName.trim().length > 0;
  const garmentsComplete = garmentCount > 0;
  const completedSteps = [companyComplete, domainsComplete, shopifyConnected, garmentsComplete]
    .filter(Boolean).length;

  const handleCompanySubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setMessage('');
    setIsError(false);

    startTransition(async () => {
      const result = await updateTenantCompanyName(name);
      setMessage(result.message);
      setIsError(!result.success);
      if (result.success) {
        setSavedName(name.trim());
        router.refresh();
      }
    });
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-10 p-6">
      <header>
        <p className="text-sm font-medium text-obsidian-accent-muted">Getting started</p>
        <h1 className="mt-1 text-3xl font-bold text-obsidian-ink">Set up your fitting room</h1>
        <p className="mt-2 text-sm text-obsidian-muted">
          Four steps to a live Try On. You can leave and come back — progress is saved as you go.
        </p>
        <div
          className="mt-5 h-2 overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-label="Onboarding progress"
          aria-valuemin={0}
          aria-valuemax={4}
          aria-valuenow={completedSteps}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-obsidian-accent to-obsidian-accent-end transition-[width]"
            style={{ width: `${(completedSteps / 4) * 100}%` }}
          />
        </div>
        <p className="mt-2 text-sm text-obsidian-muted">{completedSteps} of 4 steps complete.</p>
      </header>

      <StepShell
        index={1}
        complete={companyComplete}
        title="Confirm your company"
        description="This name appears on your dashboard and in merchant records."
      >
        <form onSubmit={handleCompanySubmit} className="obsidian-glass flex flex-col gap-4 p-6">
          <label className="flex flex-col gap-2 text-sm font-medium text-obsidian-ink">
            Company name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={160}
              placeholder="Brand Co"
              className="obsidian-input-box text-sm"
            />
          </label>
          {message ? (
            <p className={`text-sm ${isError ? 'text-rose-300' : 'text-emerald-300'}`}>{message}</p>
          ) : null}
          <button type="submit" disabled={isPending} className="obsidian-cta self-start">
            {isPending ? 'Saving…' : 'Save company name'}
          </button>
        </form>
      </StepShell>

      <StepShell
        index={2}
        complete={domainsComplete}
        title="Allow your storefront"
        description="The widget only mints a token for origins on this list."
      >
        <DomainAllowlistForm initialDomains={initialDomains} />
      </StepShell>

      <StepShell
        index={3}
        complete={shopifyConnected}
        title="Connect Shopify and install the block"
        description="Authorize the Ashrium VFR Partner app once; catalog ingest runs server-side."
      >
        <div className="obsidian-glass flex flex-col gap-4 p-6">
          <p className="text-sm text-obsidian-muted">
            {shopifyConnected && shopDomain
              ? `Connected to ${shopDomain}. Add the "Virtual fitting room" app block to your product template.`
              : 'Connect Shopify with OAuth, then add the "Virtual fitting room" app block to your product template.'}
          </p>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-obsidian-subtle">
              Ashrium platform URL for the block
            </p>
            <p className="mt-1 break-all font-mono text-sm text-obsidian-ink">
              {platformUrl || 'Set APP_BASE_URL to display your platform URL.'}
            </p>
          </div>
          <Link href="/settings/integrations" className="obsidian-cta self-start no-underline">
            {shopifyConnected ? 'Review Shopify connection' : 'Connect Shopify'}
          </Link>
        </div>
      </StepShell>

      <StepShell
        index={4}
        complete={garmentsComplete}
        title="Add your first garment"
        description="Sync from Shopify or create a CAD profile by hand."
      >
        <div className="obsidian-glass flex flex-col gap-4 p-6">
          <p className="text-sm text-obsidian-muted">
            {garmentsComplete
              ? `${garmentCount} garment${garmentCount === 1 ? '' : 's'} in your library. Open the sandbox to preview a drape.`
              : 'Your garment library is empty. Sync your catalog to grade sizes and materials.'}
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/dashboard/garments" className="obsidian-cta no-underline">
              {garmentsComplete ? 'Open garment library' : 'Add a garment'}
            </Link>
            <Link
              href="/merchant/dashboard"
              className="rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-obsidian-ink transition hover:border-obsidian-accent hover:bg-white/5"
            >
              Go to dashboard
            </Link>
          </div>
        </div>
      </StepShell>
    </main>
  );
}
