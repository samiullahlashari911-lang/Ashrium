import type { Metadata } from 'next';
import Link from 'next/link';

import { AshriumWordmark } from '@/components/brand/ashrium-logo';
import { ThemeShell } from '@/components/theme/atmosphere-backdrop';
import {
  AGE_ATTESTATION_LABEL,
  CONSENT_CHECKBOX_LABEL,
  CONSENT_SUMMARY,
  FITTED_CLOTHING_COPY,
  PRIVACY_SECTIONS,
  UNDER_16_REFUSAL,
} from '@/lib/privacy/consent-copy';

export const metadata: Metadata = {
  title: 'Privacy & consent — Ashrium',
  description:
    'How Ashrium handles fitting photos, height, sex, optional weight, and short-lived body vectors.',
};

export default function PrivacyPage(): React.JSX.Element {
  return (
    <ThemeShell intensity="subtle">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-8">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="inline-flex">
            <AshriumWordmark
              markClassName="h-8 w-8 shrink-0"
              wordClassName="text-base font-semibold tracking-[0.04em] text-ash-ink"
            />
          </Link>
          <Link
            href="/sign-in"
            className="rounded-full border border-ash-line px-4 py-2 text-sm font-semibold text-ash-ink transition hover:border-ash-accent hover:bg-ash-raised"
          >
            Merchant sign in
          </Link>
        </header>

        <article className="flex flex-col gap-8 py-16">
          <header className="flex flex-col gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ash-accent">
              Privacy
            </p>
            <h1 className="text-4xl font-bold tracking-tight text-ash-ink">
              Fitting consent
            </h1>
            <p className="text-base text-ash-muted">
              Ashrium is a virtual fitting room. A shopper session is a short-lived
              measurement, not an account. Merchants see aggregated return-rate
              telemetry, not your photos.
            </p>
          </header>

          <section className="ash-card p-6">
            <h2 className="text-lg font-semibold text-ash-ink">The fitting checkbox</h2>
            <p className="mt-2 text-sm leading-relaxed text-ash-muted">
              {CONSENT_CHECKBOX_LABEL}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-ash-muted">{CONSENT_SUMMARY}</p>
          </section>

          <section className="ash-card p-6">
            <h2 className="text-lg font-semibold text-ash-ink">Age</h2>
            <p className="mt-2 text-sm leading-relaxed text-ash-muted">
              {AGE_ATTESTATION_LABEL} {UNDER_16_REFUSAL}
            </p>
          </section>

          <section className="ash-card p-6">
            <h2 className="text-lg font-semibold text-ash-ink">Fitted clothing</h2>
            <p className="mt-2 text-sm leading-relaxed text-ash-muted">
              {FITTED_CLOTHING_COPY}
            </p>
          </section>

          {PRIVACY_SECTIONS.map((section) => (
            <section key={section.title} className="ash-card p-6">
              <h2 className="text-lg font-semibold text-ash-ink">{section.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-ash-muted">{section.body}</p>
            </section>
          ))}
        </article>

        <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-ash-line py-6 text-sm text-ash-subtle">
          <span>© {new Date().getFullYear()} Ashrium</span>
          <Link href="/" className="hover:text-ash-ink">
            Home
          </Link>
        </footer>
      </div>
    </ThemeShell>
  );
}
