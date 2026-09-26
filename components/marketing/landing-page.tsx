'use client';

import Link from 'next/link';
import { useState, type JSX } from 'react';

import { AshriumWordmark } from '@/components/brand/ashrium-logo';
import { BookCallDialog } from '@/components/marketing/book-call-dialog';
import { ProductStage } from '@/components/marketing/product-stage';

const PACKAGE_PRICE = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
}).format(3500);

const NAV = [
  { href: '#product', label: 'Product' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#guarantee', label: 'Guarantee' },
  { href: '#shopify', label: 'Shopify' },
  { href: '#privacy', label: 'Privacy' },
  { href: '#pricing', label: 'Pricing' },
] as const;

const STEPS = [
  {
    title: 'Consent and age',
    detail: 'The shopper confirms they are 16 or older and agrees before the camera opens.',
  },
  {
    title: 'Two guided photos',
    detail: 'Front and side. The head is cropped on their phone, so a face never uploads.',
  },
  {
    title: 'Avatar and drape',
    detail: 'A real body is fit from those photos, then the garment is draped on it.',
  },
  {
    title: 'Size in the cart',
    detail: 'A specific size when every check passes. Approximate fit when one does not.',
  },
] as const;

const SHOPIFY_STEPS = [
  { title: 'Connect the store', detail: 'Shopify Admin stays on the server. The shopper never sees a credential.' },
  { title: 'Ingest one SKU', detail: 'Paste a product. The garment is graded from the size chart you already publish.' },
  { title: 'Install the theme block', detail: 'Try on sits on the product page, in the theme you already use.' },
  { title: 'Go live', detail: 'Shoppers fit the garment. You watch the return rate on the dashboard.' },
] as const;

const INCLUDED = [
  'Shopify product-page embed',
  'Catalog ingest for each SKU',
  'Fitting room with a real avatar',
  'Size recommendation, or Approximate fit',
  'Return-rate dashboard',
  'Managed setup',
] as const;

const QUESTIONS = [
  {
    q: 'Is this only for Shopify?',
    a: 'Yes. The fitting room embeds on a Shopify product page.',
  },
  {
    q: 'What does the shopper do?',
    a: 'They confirm they are 16 or older, consent, enter height and sex, and can add weight. Then they take a guided front photo and a side photo.',
  },
  {
    q: 'When does a size reach the cart?',
    a: 'When capture, garment quality, and the drape all pass. If any check fails, they see Approximate fit and no hard size is written.',
  },
  {
    q: 'How long do you keep the photos?',
    a: 'They are wiped when the fit finishes, and never kept longer than 15 minutes. The head is cropped on the device before upload.',
  },
  {
    q: 'What does the 15% guarantee cover?',
    a: 'A guaranteed reduction in return rate. You watch it on the return-rate dashboard.',
  },
] as const;

const SPEC = [
  { label: 'Return rate', value: '15% lower, guaranteed' },
  { label: 'Conversion', value: 'Up to 20% higher' },
  { label: 'Where you watch it', value: 'Return-rate dashboard' },
  { label: 'What sets the size', value: 'Girths and your size chart' },
] as const;

const focusRing = 'rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white';

export function MarketingHome(): JSX.Element {
  const [bookingOpen, setBookingOpen] = useState(false);

  return (
    <div className="min-h-screen touch-manipulation overflow-x-hidden">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:text-obsidian-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-white/10 bg-obsidian-canvas/95 pt-[env(safe-area-inset-top)]">
        <div className="marketing-wrap flex flex-wrap items-center gap-x-8 gap-y-3 py-4">
          <a href="#main" className={`mr-auto shrink-0 ${focusRing}`} translate="no">
            <AshriumWordmark
              markClassName="h-8 w-8 shrink-0"
              wordClassName="text-[15px] font-medium tracking-[0.01em] text-obsidian-ink"
            />
          </a>
          <nav aria-label="Page sections" className="order-last w-full min-w-0 lg:order-none lg:w-auto">
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-obsidian-muted">
              {NAV.map((item) => (
                <li key={item.href}>
                  <a href={item.href} className={`transition-colors duration-150 hover:text-obsidian-ink ${focusRing}`}>
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <Link href="/sign-in" className={`text-sm text-obsidian-muted transition-colors duration-150 hover:text-obsidian-ink ${focusRing}`}>
            Merchant sign in
          </Link>
          <button type="button" className="obsidian-cta" onClick={() => setBookingOpen(true)}>
            Book a Call
          </button>
        </div>
      </header>

      <main id="main">
        <section className="marketing-wrap relative grid items-center gap-14 py-16 sm:py-20 lg:grid-cols-[minmax(0,1.05fr)_minmax(280px,0.85fr)] lg:gap-16 lg:py-24">
          <div className="min-w-0 max-w-xl">
            <h1 className="text-balance text-[2.75rem] font-medium leading-[1.02] tracking-[-0.03em] sm:text-6xl lg:text-[4.25rem]">
              Fewer returns, guaranteed.
            </h1>
            <p className="mt-6 text-pretty text-[17px] leading-7 text-obsidian-muted">
              Ashrium is a virtual fitting room for Shopify. A shopper takes two guided photos. You get an avatar, a draped garment, and a size in the cart when the fit is confident.
            </p>
            <p className="mt-4 text-pretty text-[17px] leading-7 text-obsidian-muted">
              Return rate 15% lower, guaranteed. Conversion up to 20% higher.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-5">
              <button type="button" className="obsidian-cta" onClick={() => setBookingOpen(true)}>
                Book a Call
              </button>
              <a href="#how-it-works" className={`text-sm text-obsidian-ink underline decoration-white/25 underline-offset-4 transition-colors duration-150 hover:decoration-white ${focusRing}`}>
                See how it works
              </a>
            </div>
          </div>
          <ProductStage />
        </section>

        <section id="product" className="marketing-anchor border-t border-white/10">
          <div className="marketing-wrap grid gap-10 py-20 sm:py-24 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-20">
            <h2 className="text-balance text-3xl font-medium tracking-[-0.02em]">
              What the shopper sees on your product page.
            </h2>
            <div className="min-w-0 text-[17px] leading-7 text-obsidian-muted">
              <p className="text-pretty">
                Try on opens beside the product. The avatar is faceless and not skin-toned. The garment is draped on it.
              </p>
              <p className="mt-4 text-pretty">
                When capture, garment quality, and the drape all pass, the size is written into the cart. When a check fails, the shopper sees Approximate fit and no hard size is claimed.
              </p>
              <p className="mt-4 text-pretty">
                A clearance heatmap can be turned on. Loose regions read blue. The heatmap does not choose the size.
              </p>
            </div>
          </div>
        </section>

        <section className="border-t border-white/10">
          <div className="marketing-wrap grid gap-8 py-20 sm:py-24 lg:grid-cols-2 lg:gap-20">
            <h2 className="text-balance text-3xl font-medium tracking-[-0.02em]">
              Size uncertainty quietly costs the sale.
            </h2>
            <p className="text-pretty text-[17px] leading-7 text-obsidian-muted">
              A shopper who cannot tell which size will fit either leaves, or buys two and sends one back. Showing the fit on their avatar happens before checkout, on the product page they are already on.
            </p>
          </div>
        </section>

        <section id="how-it-works" className="marketing-anchor border-t border-white/10">
          <div className="marketing-wrap py-20 sm:py-24">
            <h2 className="text-balance text-3xl font-medium tracking-[-0.02em]">
              From consent to the cart.
            </h2>
            <ol className="mt-12 grid gap-px overflow-hidden rounded-3xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step, index) => (
                <li key={step.title} className="min-w-0 bg-obsidian-canvas px-5 py-6">
                  <span className="text-sm tabular-nums text-obsidian-subtle">{index + 1}</span>
                  <h3 className="mt-4 text-lg font-medium text-obsidian-ink">{step.title}</h3>
                  <p className="mt-2 text-pretty text-[15px] leading-6 text-obsidian-muted">{step.detail}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="guarantee" className="marketing-anchor border-t border-white/10 bg-[#141428]">
          <div className="marketing-wrap grid items-end gap-12 py-20 sm:py-28 lg:grid-cols-2 lg:gap-20">
            <div>
              <p className="text-[clamp(5rem,14vw,8rem)] font-medium leading-[0.85] tracking-[-0.05em] tabular-nums">
                15%
              </p>
              <h2 className="mt-6 max-w-sm text-balance text-3xl font-medium tracking-[-0.02em]">
                Fewer returns, guaranteed.
              </h2>
              <p className="mt-4 max-w-md text-pretty text-[17px] leading-7 text-obsidian-muted">
                The commercial promise is a 15% reduction in return rate. Fabric and the heatmap do not move that number.
              </p>
            </div>
            <dl>
              {SPEC.map((row) => (
                <div key={row.label} className="grid gap-1 border-t border-white/10 py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6">
                  <dt className="text-sm text-obsidian-subtle">{row.label}</dt>
                  <dd className="text-pretty text-[17px] text-obsidian-ink">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="border-t border-white/10">
          <div className="marketing-wrap grid items-end gap-6 py-20 sm:py-24 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.1fr)] lg:gap-16">
            <h2 className="text-balance text-[clamp(2.5rem,6vw,4.5rem)] font-medium leading-[0.95] tracking-[-0.04em]">
              Up to 20% higher conversion.
            </h2>
            <p className="text-pretty text-[17px] leading-7 text-obsidian-muted">
              Shoppers who can see the fit before they buy are more ready to check out. The measured lift is up to 20%.
            </p>
          </div>
        </section>

        <section id="shopify" className="marketing-anchor border-t border-white/10">
          <div className="marketing-wrap py-20 sm:py-24">
            <div className="max-w-xl">
              <h2 className="text-balance text-3xl font-medium tracking-[-0.02em]">
                On your Shopify store in four steps.
              </h2>
              <p className="mt-4 text-pretty text-[17px] leading-7 text-obsidian-muted">
                Shopify only. Connect the store, ingest the garment, and place Try on on the product page.
              </p>
            </div>
            <ol className="mt-12 grid gap-px overflow-hidden rounded-3xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
              {SHOPIFY_STEPS.map((step, index) => (
                <li key={step.title} className="min-w-0 bg-obsidian-canvas px-5 py-6">
                  <span className="text-sm tabular-nums text-obsidian-subtle">{index + 1}</span>
                  <h3 className="mt-4 text-lg font-medium">{step.title}</h3>
                  <p className="mt-2 text-pretty text-[15px] leading-6 text-obsidian-muted">{step.detail}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="privacy" className="marketing-anchor border-t border-white/10">
          <div className="marketing-wrap grid gap-8 py-20 sm:py-24 lg:grid-cols-2 lg:gap-20">
            <h2 className="text-balance text-3xl font-medium tracking-[-0.02em]">
              The camera opens after consent.
            </h2>
            <ul className="space-y-3 text-pretty text-[17px] leading-7 text-obsidian-muted">
              <li>Age attestation is 16 or older. Under 16 stops there.</li>
              <li>Consent comes before the camera.</li>
              <li>The head is cropped on the device.</li>
              <li>Photos are destroyed within 15 minutes.</li>
              <li>The mannequin is faceless and not skin-toned.</li>
            </ul>
          </div>
        </section>

        <section id="pricing" className="marketing-anchor border-t border-white/10">
          <div className="marketing-wrap grid gap-12 py-20 sm:py-24 lg:grid-cols-2 lg:gap-20">
            <div>
              <h2 className="text-balance text-3xl font-medium tracking-[-0.02em]">
                One managed package.
              </h2>
              <p className="mt-6 text-5xl font-medium tabular-nums tracking-[-0.03em]">{PACKAGE_PRICE}</p>
              <p className="mt-3 text-[17px] leading-7 text-obsidian-muted">
                Per merchant. There is no self-serve signup.
              </p>
              <button type="button" className="obsidian-cta mt-8" onClick={() => setBookingOpen(true)}>
                Book a Call
              </button>
            </div>
            <ul className="border-t border-white/10">
              {INCLUDED.map((item) => (
                <li key={item} className="border-b border-white/10 py-4 text-[17px] text-obsidian-ink">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="border-t border-white/10">
          <div className="marketing-wrap py-20 sm:py-24">
            <h2 className="text-balance text-3xl font-medium tracking-[-0.02em]">
              Questions before you book.
            </h2>
            <dl className="mt-10 max-w-3xl border-t border-white/10">
              {QUESTIONS.map((item) => (
                <div key={item.q} className="border-b border-white/10 py-6">
                  <dt className="text-lg font-medium text-obsidian-ink">{item.q}</dt>
                  <dd className="mt-2 max-w-prose text-pretty text-[17px] leading-7 text-obsidian-muted">{item.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="border-t border-white/10">
          <div className="marketing-wrap py-20 sm:py-28">
            <h2 className="max-w-xl text-balance text-4xl font-medium tracking-[-0.02em] sm:text-5xl">
              Ready for 15% fewer returns?
            </h2>
            <button type="button" className="obsidian-cta mt-8" onClick={() => setBookingOpen(true)}>
              Book a Call
            </button>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 pb-[env(safe-area-inset-bottom)]">
        <div className="marketing-wrap grid gap-8 py-10 text-sm text-obsidian-subtle sm:grid-cols-[auto_1fr_auto] sm:items-start">
          <span translate="no" className="text-obsidian-ink">Ashrium</span>
          <p className="max-w-xs text-pretty">Virtual fitting room for Shopify merchants.</p>
          <div className="flex flex-col gap-2">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} className={`hover:text-obsidian-ink ${focusRing}`}>
                {item.label}
              </a>
            ))}
            <Link href="/sign-in" className={`hover:text-obsidian-ink ${focusRing}`}>
              Merchant sign in
            </Link>
            <Link href="/privacy" className={`hover:text-obsidian-ink ${focusRing}`}>
              Privacy
            </Link>
          </div>
        </div>
      </footer>

      <BookCallDialog open={bookingOpen} onClose={() => setBookingOpen(false)} />
    </div>
  );
}
