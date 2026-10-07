'use client';

import Link from 'next/link';
import { useState, type JSX, type ReactNode } from 'react';

import { AshriumWordmark } from '@/components/brand/ashrium-logo';
import { BookCallDialog } from '@/components/marketing/book-call-dialog';
import { MannequinShowcase } from '@/components/marketing/mannequin-showcase';
import { CONSENT_BULLETS } from '@/lib/privacy/consent-copy';
import { CAPTURE_OUTLINES } from '@/lib/widget/capture-outlines';

const NAV = [
  { href: '#how', label: 'How it works' },
  { href: '#privacy', label: 'Privacy' },
  { href: '#merchants', label: 'For merchants' },
  { href: '#faq', label: 'FAQ' },
] as const;

const STEPS = [
  {
    title: 'A few quick questions',
    body: 'Height on a smooth wheel, body profile, and optional weight. Consent and 16+ come first; the camera stays off until then.',
  },
  {
    title: 'Two guided photos',
    body: 'The outline turns green when the shopper is in place and the photo takes itself. The head is removed on the phone.',
  },
  {
    title: 'Their 3D fit',
    body: 'A 3D avatar from the live GPU, your garment draped on it, a fit heatmap, and the right size added to the cart.',
  },
] as const;

const QUESTIONS = [
  {
    q: 'What does the shopper do?',
    a: 'Tap “Try it on in 3D” above Add to cart, agree, set height and body profile (weight is optional), then take a front and a side photo. The camera guides them and captures automatically.',
  },
  {
    q: 'How long does it take?',
    a: 'About a minute of the shopper’s time. The 3D avatar is built on a dedicated GPU that starts warming the moment they agree, so it is usually ready shortly after the second photo.',
  },
  {
    q: 'When is a size added to the cart?',
    a: 'A confident size is shown only when every check passes: both photos, your product’s size data, and a completed cloth simulation. Otherwise the shopper sees an approximate fit with the reason.',
  },
  {
    q: 'What happens to the photos?',
    a: 'The head is removed on the phone before upload. Photos are deleted as soon as the avatar is built, and never kept longer than 15 minutes. They are never sold or used to train models.',
  },
  {
    q: 'Which stores does it work with?',
    a: 'Shopify, as a theme block on the product page. A WooCommerce version is on the way.',
  },
] as const;

function Check(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Eyebrow({ children }: { children: ReactNode }): JSX.Element {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ash-accent">{children}</p>
  );
}

/** The real capture outline, tracing green as it does on the phone. */
function OutlineTrace({ className = '' }: { className?: string }): JSX.Element {
  const outline = CAPTURE_OUTLINES.female.front;
  return (
    <svg viewBox={outline.viewBox} className={className} aria-hidden="true">
      <path d={outline.path} fill="rgba(34,199,122,0.16)" stroke="#22C77A" strokeWidth={7} strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 10px rgba(34,199,122,0.6))' }} />
      <path
        d={outline.path}
        fill="none"
        stroke="#fff"
        strokeWidth={9}
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray="100 100"
        className="mkt-trace"
      />
    </svg>
  );
}

function PhoneFrame({ children, className = '' }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <div className={`rounded-[34px] border border-ash-line bg-ash-surface p-2 shadow-lift ${className}`}>
      <div className="relative overflow-hidden rounded-[27px] bg-ash-canvas">{children}</div>
    </div>
  );
}

function FittingPanel(): JSX.Element {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-ash-line bg-ash-surface p-4 shadow-card">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ash-accent">Your fitting</p>
        <p className="mt-0.5 text-sm font-semibold">Relaxed linen shirt</p>
      </div>
      <div className="flex items-start justify-between rounded-xl bg-ash-raised p-3">
        <div>
          <p className="text-[11px] text-ash-muted">Recommended size</p>
          <p className="text-3xl font-semibold leading-none">M</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-ash-success px-2.5 py-1 text-[10px] font-semibold text-white">
          <Check />
          Confident fit
        </span>
      </div>
      <div className="flex gap-1.5">
        {['S', 'M', 'L', 'XL'].map((size) => (
          <span
            key={size}
            className={[
              'rounded-lg border px-2.5 py-1 text-xs font-semibold',
              size === 'M' ? 'border-ash-accent bg-ash-accent text-white' : 'border-ash-line text-ash-ink',
            ].join(' ')}
          >
            {size}
          </span>
        ))}
      </div>
      <div className="flex items-center justify-between rounded-xl border border-ash-line px-3 py-2">
        <div>
          <p className="text-xs font-semibold">Fit heatmap</p>
          <p className="text-[10px] text-ash-muted">Blue is roomy, red is snug.</p>
        </div>
        <span className="relative h-5 w-9 rounded-full bg-ash-accent" aria-hidden="true">
          <span className="absolute right-0.5 top-0.5 h-4 w-4 rounded-full bg-white" />
        </span>
      </div>
      <span className="ash-cta w-full py-2.5 text-xs">Add size M to cart</span>
    </div>
  );
}

function Hero({ onBook }: { onBook: () => void }): JSX.Element {
  return (
    <section className="relative overflow-hidden pb-16 pt-10 md:pb-24 md:pt-16" aria-labelledby="hero-title">
      <div aria-hidden="true" className="pointer-events-none absolute right-[-15%] top-[-20%] h-[640px] w-[640px] rounded-full bg-[radial-gradient(closest-side,rgba(106,76,245,0.12),transparent)]" />
      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_1.15fr]">
        <div className="ash-page-in flex flex-col gap-6">
          <Eyebrow>The 3D fitting room for Shopify</Eyebrow>
          <h1 id="hero-title" className="text-balance text-[40px] font-semibold leading-[1.05] tracking-tight sm:text-[56px]">
            See it on. Size it right. Return less.
          </h1>
          <p className="max-w-xl text-pretty text-lg leading-relaxed text-ash-muted">
            Ashrium turns two guided phone photos into a 3D avatar of your shopper, drapes your garment on it, and adds the right size to the cart.
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={onBook} className="ash-cta px-6 py-3.5 text-[15px]">
              Book a call
            </button>
            <a href="#how" className="ash-cta-secondary px-6 py-3.5 text-[15px]">
              See how it works
            </a>
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ash-muted">
            {['Faces never leave the phone', 'Photos deleted in 15 minutes', 'Built for Shopify'].map((item) => (
              <li key={item} className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ash-success-soft text-ash-success">
                  <Check />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mx-auto w-full max-w-[640px] pb-10 lg:pb-0">
          <div className="overflow-hidden rounded-[28px] border border-ash-line bg-ash-surface shadow-lift">
            <div className="flex items-center gap-1.5 border-b border-ash-line px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-[#F0444F]/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#22C77A]/70" />
              <span className="ml-3 truncate text-xs text-ash-subtle">yourstore.com/products/relaxed-linen-shirt</span>
            </div>
            <div className="grid grid-cols-1 gap-3 bg-ash-canvas p-3 sm:grid-cols-[1fr_230px]">
              <div className="relative overflow-hidden rounded-2xl bg-[radial-gradient(120%_80%_at_50%_15%,#ffffff_0%,#f4f1ec_70%)]">
                <MannequinShowcase className="h-[360px] sm:h-[380px]" />
                <span className="absolute left-3 top-3 rounded-full bg-white/85 px-2.5 py-1 text-[10px] font-semibold text-ash-ink shadow-card">
                  Live 3D mannequin
                </span>
              </div>
              <FittingPanel />
            </div>
          </div>
          <PhoneFrame className="absolute -left-1 top-[170px] w-[104px] sm:-bottom-2 sm:-left-10 sm:top-auto sm:w-[150px] lg:-bottom-10">
            <div className="flex h-[230px] flex-col bg-[#17151C] sm:h-[270px]">
              <div className="flex flex-1 items-center justify-center p-3">
                <OutlineTrace className="h-full max-w-full" />
              </div>
              <div className="flex justify-center pb-3">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[9px] font-semibold text-ash-ink">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#22C77A]" />
                  Perfect, hold still
                </span>
              </div>
            </div>
          </PhoneFrame>
        </div>
      </div>
    </section>
  );
}

function StepVisual({ index }: { index: number }): JSX.Element {
  if (index === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2" aria-hidden="true">
        <span className="rounded-full bg-ash-line/60 p-1 text-[11px] font-semibold">
          <span className="inline-block rounded-full bg-white px-3 py-1 shadow-card">cm</span>
          <span className="inline-block px-3 py-1 text-ash-muted">ft / in</span>
        </span>
        {[168, 169, 170, 171, 172].map((cm) => (
          <span
            key={cm}
            className={[
              'w-36 rounded-xl py-1 text-center tabular-nums',
              cm === 170 ? 'bg-ash-accent-soft text-lg font-semibold' : 'text-sm text-ash-muted',
              Math.abs(cm - 170) === 2 ? 'opacity-30' : '',
            ].join(' ')}
          >
            {cm} cm
          </span>
        ))}
      </div>
    );
  }
  if (index === 1) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl bg-[#17151C] p-4" aria-hidden="true">
        <OutlineTrace className="h-full max-h-[210px]" />
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center" aria-hidden="true">
      <div className="w-full max-w-[220px]">
        <FittingPanel />
      </div>
    </div>
  );
}

export function MarketingHome(): JSX.Element {
  const [bookingOpen, setBookingOpen] = useState(false);
  const [faqOpen, setFaqOpen] = useState<number | null>(0);
  const openBooking = (): void => setBookingOpen(true);

  return (
    <div className="min-h-screen overflow-x-hidden bg-ash-canvas text-ash-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-ash-line/70 bg-ash-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <a href="#main" aria-label="Ashrium home">
            <AshriumWordmark markClassName="h-7 w-7 shrink-0 text-ash-accent" wordClassName="text-[15px] font-semibold tracking-[0.01em]" />
          </a>
          <nav aria-label="Page sections" className="hidden items-center gap-7 text-sm text-ash-muted md:flex">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} className="transition hover:text-ash-ink">
                {item.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/sign-in" className="hidden rounded-xl px-3 py-2 text-sm font-semibold text-ash-muted transition hover:text-ash-ink sm:inline-flex">
              Merchant sign in
            </Link>
            <button type="button" onClick={openBooking} className="ash-cta px-4 py-2.5">
              Book a call
            </button>
          </div>
        </div>
      </header>

      <main id="main">
        <Hero onBook={openBooking} />

        <section id="how" className="scroll-mt-20 py-16 md:py-24" aria-labelledby="how-title">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <div className="flex max-w-2xl flex-col gap-3">
              <Eyebrow>How it works</Eyebrow>
              <h2 id="how-title" className="text-balance text-3xl font-semibold tracking-tight sm:text-[40px] sm:leading-tight">
                About a minute from “Try it on” to “Add to cart”.
              </h2>
            </div>
            <ol className="mt-10 grid gap-5 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title} className="ash-card flex flex-col gap-5 p-6">
                  <div className="h-[260px] overflow-hidden rounded-2xl bg-ash-raised p-3">
                    <StepVisual index={index} />
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ash-accent text-sm font-semibold text-white">
                      {index + 1}
                    </span>
                    <div>
                      <h3 className="text-lg font-semibold">{step.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-ash-muted">{step.body}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="privacy" className="scroll-mt-20 py-16 md:py-24" aria-labelledby="privacy-title">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div className="flex flex-col gap-4">
              <Eyebrow>Privacy by design</Eyebrow>
              <h2 id="privacy-title" className="text-balance text-3xl font-semibold tracking-tight sm:text-[40px] sm:leading-tight">
                The fitting room that forgets.
              </h2>
              <p className="text-lg leading-relaxed text-ash-muted">
                Shoppers agree before the camera opens, the head is removed on their phone, and photos are gone within minutes. The same promises appear in the widget, word for word.
              </p>
              <Link href="/privacy" className="self-start text-sm font-semibold text-ash-accent underline-offset-4 hover:underline">
                Read the privacy notice
              </Link>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2">
              {CONSENT_BULLETS.map((bullet) => (
                <li key={bullet.title} className="ash-card flex flex-col gap-2 p-5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ash-accent-soft text-ash-accent">
                    <Check />
                  </span>
                  <h3 className="font-semibold">{bullet.title}</h3>
                  <p className="text-sm leading-relaxed text-ash-muted">{bullet.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="merchants" className="scroll-mt-20 py-16 md:py-24" aria-labelledby="merchants-title">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <div className="overflow-hidden rounded-[32px] bg-ash-ink px-6 py-12 text-white sm:px-12 md:py-16">
              <div className="grid gap-10 lg:grid-cols-[1fr_1fr] lg:items-center">
                <div className="flex flex-col gap-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#B9A9FF]">For merchants</p>
                  <h2 id="merchants-title" className="text-balance text-3xl font-semibold tracking-tight sm:text-[40px] sm:leading-tight">
                    Fewer returns, guaranteed.
                  </h2>
                  <p className="text-lg leading-relaxed text-white/70">
                    A managed rollout on your Shopify store: we connect your catalog, ingest your size charts, and install the theme block. Your dashboard tracks try-ons, conversion, and returns.
                  </p>
                  <button type="button" onClick={openBooking} className="ash-cta self-start px-6 py-3.5 text-[15px]">
                    Book a call
                  </button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-3xl bg-white/[0.06] p-6 ring-1 ring-white/10">
                    <p className="text-5xl font-semibold tracking-tight">15%</p>
                    <p className="mt-2 font-semibold">Fewer returns</p>
                    <p className="mt-1 text-sm text-white/60">The commercial promise: a 15% reduction in return rate.</p>
                  </div>
                  <div className="rounded-3xl bg-white/[0.06] p-6 ring-1 ring-white/10">
                    <p className="text-5xl font-semibold tracking-tight">20%</p>
                    <p className="mt-2 font-semibold">Higher conversion</p>
                    <p className="mt-1 text-sm text-white/60">Shoppers who can see the fit are readier to check out: up to 20% lift.</p>
                  </div>
                  <div className="rounded-3xl bg-white/[0.06] p-6 ring-1 ring-white/10 sm:col-span-2">
                    <p className="font-semibold">Honest sizes only</p>
                    <p className="mt-1 text-sm text-white/60">
                      A confident size needs every check to pass. Otherwise shoppers see “Approximate fit” and why, so trust is never spent on a guess.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="faq" className="scroll-mt-20 py-16 md:py-24" aria-labelledby="faq-title">
          <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
            <Eyebrow>FAQ</Eyebrow>
            <h2 id="faq-title" className="mt-3 text-3xl font-semibold tracking-tight sm:text-[40px]">Questions, answered</h2>
            <div className="mt-8 flex flex-col gap-3">
              {QUESTIONS.map((item, index) => {
                const open = faqOpen === index;
                return (
                  <div key={item.q} className="ash-card overflow-hidden">
                    <h3>
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setFaqOpen(open ? null : index)}
                        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-semibold"
                      >
                        {item.q}
                        <span
                          aria-hidden="true"
                          className={['flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ash-raised text-ash-muted transition-transform duration-300', open ? 'rotate-45' : ''].join(' ')}
                        >
                          +
                        </span>
                      </button>
                    </h3>
                    <div className={['grid transition-[grid-template-rows] duration-300', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'].join(' ')}>
                      <p className="overflow-hidden px-5 text-sm leading-relaxed text-ash-muted">
                        <span className="block pb-5">{item.a}</span>
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="pb-20 pt-4" aria-labelledby="close-title">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <div className="flex flex-col items-center gap-5 rounded-[32px] bg-ash-accent-soft px-6 py-14 text-center">
              <h2 id="close-title" className="text-balance text-3xl font-semibold tracking-tight sm:text-[40px]">
                Ready to let shoppers try before they buy?
              </h2>
              <p className="max-w-xl text-ash-muted">A 30-minute call to see Ashrium on your own products.</p>
              <button type="button" onClick={openBooking} className="ash-cta px-7 py-4 text-[15px]">
                Book a call
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-ash-line">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <AshriumWordmark markClassName="h-6 w-6 shrink-0 text-ash-accent" wordClassName="text-sm font-semibold" />
          <div className="flex gap-6 text-sm text-ash-muted">
            <Link href="/privacy" className="hover:text-ash-ink">Privacy</Link>
            <Link href="/sign-in" className="hover:text-ash-ink">Merchant sign in</Link>
          </div>
          <p className="text-xs text-ash-subtle">© {new Date().getFullYear()} Ashrium</p>
        </div>
      </footer>

      <BookCallDialog open={bookingOpen} onClose={() => setBookingOpen(false)} />
    </div>
  );
}
