import type { Metadata } from 'next';
import Link from 'next/link';

import { AshriumWordmark } from '@/components/brand/ashrium-logo';
import { ThemeShell } from '@/components/theme/atmosphere-backdrop';

export const metadata: Metadata = {
  title: 'Ashrium — Virtual fitting room for Shopify',
  description:
    'Ashrium builds a real 3D avatar from two guided photos, drapes your catalog on it, and only claims a size when confidence is high.',
};

interface Capability {
  body: string;
  title: string;
}

const CAPABILITIES: readonly Capability[] = [
  {
    title: 'Two photos, one real avatar',
    body: 'Shoppers enter height and sex, pass a guided front and side capture, and get an avatar from a live parametric body inference — not a generic mannequin.',
  },
  {
    title: 'Your catalog, graded server-side',
    body: 'We ingest products from Shopify Admin, map the material through a KES table, and grade rest lengths per size variant. Credentials never leave the server.',
  },
  {
    title: 'A size claim you can defend',
    body: 'A hard size is written to the cart only when capture, garment ingest quality, and the drape solve all pass. Anything less is shown as an approximate fit.',
  },
  {
    title: 'Photos that do not linger',
    body: 'Capture images are uploaded to a short-lived bucket and wiped the moment inference finishes, whether it succeeded or failed.',
  },
];

interface FlowStep {
  detail: string;
  label: string;
}

const FLOW_STEPS: readonly FlowStep[] = [
  { label: 'Capture', detail: 'Guided front and side photos with live pose gates.' },
  { label: 'Fit', detail: 'Parametric body inference returns real girths.' },
  { label: 'Drape', detail: 'Cached delta or full cloth solve on the hull.' },
  { label: 'Size', detail: 'Confidence-gated size written into the cart.' },
];

export default function LandingPage(): React.JSX.Element {
  return (
    <ThemeShell intensity="hero">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8">
        <header className="flex items-center justify-between gap-4">
          <AshriumWordmark
            markClassName="h-8 w-8 shrink-0"
            wordClassName="text-base font-semibold tracking-[0.04em] text-obsidian-ink"
          />
          <Link
            href="/sign-in"
            className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-obsidian-ink transition hover:border-obsidian-accent hover:bg-white/5"
          >
            Merchant sign in
          </Link>
        </header>

        <section className="flex flex-col items-start gap-6 py-24 sm:py-32">
          <p className="rounded-full border border-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-obsidian-accent-muted">
            Managed virtual fitting room
          </p>
          <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight text-obsidian-ink sm:text-6xl">
            Stop guessing sizes. Show shoppers the fit.
          </h1>
          <p className="max-w-2xl text-lg text-obsidian-muted">
            Ashrium is a fully managed fitting room for Shopify. We build the avatar, ingest and
            grade your catalog, drape each garment, and report the return-rate impact — a single
            annual package with no per-seat billing.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/sign-in" className="obsidian-cta no-underline">
              Sign in to your workspace
            </Link>
            <a
              href="mailto:hello@ashrium.com?subject=Ashrium%20VFR%20enquiry"
              className="rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-obsidian-ink transition hover:border-obsidian-accent hover:bg-white/5"
            >
              Talk to us about onboarding
            </a>
          </div>
          <p className="text-sm text-obsidian-subtle">
            Access is contract-only. We provision each merchant workspace directly — there is no
            self-serve signup.
          </p>
        </section>

        <section aria-labelledby="capabilities-heading" className="pb-20">
          <h2 id="capabilities-heading" className="text-2xl font-semibold text-obsidian-ink">
            What the package covers
          </h2>
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            {CAPABILITIES.map((capability) => (
              <article key={capability.title} className="obsidian-glass p-6">
                <h3 className="text-lg font-semibold text-obsidian-ink">{capability.title}</h3>
                <p className="mt-2 text-sm text-obsidian-muted">{capability.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="flow-heading" className="pb-24">
          <h2 id="flow-heading" className="text-2xl font-semibold text-obsidian-ink">
            How a session runs
          </h2>
          <ol className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {FLOW_STEPS.map((step, index) => (
              <li key={step.label} className="obsidian-glass p-5">
                <span className="font-mono text-xs tabular-nums text-obsidian-accent-muted">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3 className="mt-2 text-lg font-semibold text-obsidian-ink">{step.label}</h3>
                <p className="mt-1 text-sm text-obsidian-muted">{step.detail}</p>
              </li>
            ))}
          </ol>
        </section>

        <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-white/10 py-6 text-sm text-obsidian-subtle">
          <span>© {new Date().getFullYear()} Ashrium</span>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-obsidian-ink">
              Privacy
            </Link>
            <Link href="/sign-in" className="hover:text-obsidian-ink">
              Merchant portal
            </Link>
          </div>
        </footer>
      </div>
    </ThemeShell>
  );
}
