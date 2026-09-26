'use client';

import Link from 'next/link';
import { useState, type JSX } from 'react';

import { AshriumMark } from '@/components/brand/ashrium-logo';
import { BookCallDialog } from '@/components/marketing/book-call-dialog';
import { ProductStage } from '@/components/marketing/product-stage';

const NAV = [
  { href: '#product', label: 'Product' },
  { href: '#flow', label: 'How it works' },
  { href: '#guarantee', label: 'Guarantee' },
] as const;

const FEATURES = [
  {
    title: 'Two guided photos',
    body: 'Front and side, after age and consent. The camera stays closed until both are given.',
  },
  {
    title: 'Faceless avatar',
    body: 'The mannequin has no face and is not skin-toned. The garment is shown on that form.',
  },
  {
    title: 'Size, or Approximate fit',
    body: 'A hard size reaches the cart only when the confidence gate passes. Otherwise Approximate fit.',
  },
  {
    title: 'Shopify block',
    body: 'The fitting room sits on the product page. It is a Liquid block, not a separate app.',
  },
  {
    title: 'Photos leave in 15 minutes',
    body: 'The head is cropped on the device. Photos are wiped within 15 minutes.',
  },
] as const;

const FLOW = [
  {
    title: 'Details first',
    caption:
      'Age, consent, height, and sex. Weight is optional. The camera stays closed until age and consent are both given.',
  },
  {
    title: 'Two guided photos',
    caption:
      'A front photo and a side photo. On the side view, wrists sit at or above the shoulders. The head is cropped on the device.',
  },
  {
    title: 'Avatar and a size',
    caption:
      'A faceless avatar, then either a size written to the cart or Approximate fit.',
  },
] as const;

const TRUST = [
  {
    title: 'Privacy',
    body: '16 and older, and consent, before the camera opens. The head is cropped on the device. Photos are wiped within 15 minutes.',
  },
  {
    title: 'Ease of use',
    body: 'A guided front photo and a side photo. On the side view, wrists sit at or above the shoulders.',
  },
  {
    title: 'Accuracy',
    body: 'A hard size is written to the cart only when the confidence gate passes. Otherwise the shopper sees Approximate fit. The clearance heatmap is a toggle. Loose reads blue. It does not set the size.',
  },
] as const;

const QUESTIONS = [
  {
    q: 'What does the shopper do?',
    a: 'They confirm they are 16 or older, consent, and enter height and sex. Weight is optional. Then a guided front photo and a side photo.',
  },
  {
    q: 'When is a size written to the cart?',
    a: 'When capture, the garment, and the drape all pass. That size is written into the cart.',
  },
  {
    q: 'What is Approximate fit?',
    a: 'If any check fails, the shopper sees Approximate fit. No hard size is written.',
  },
  {
    q: 'What happens to the photos?',
    a: 'The head is cropped on the device before upload. Photos are wiped when the fit finishes, and never kept longer than 15 minutes.',
  },
  {
    q: 'Is this only for Shopify?',
    a: 'Yes. The fitting room is a Liquid block on the Shopify product page.',
  },
] as const;

function CornerArrow(): JSX.Element {
  return (
    <svg className="mkt-arrow" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M20 20V2H2" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M19.5 2.5L2 20" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function LogoLockup(): JSX.Element {
  return (
    <>
      <AshriumMark className="h-7 w-7" variant="currentColor" />
      <span className="mkt-logo-word" translate="no">
        Ashrium
      </span>
    </>
  );
}

export function MarketingHome(): JSX.Element {
  const [bookingOpen, setBookingOpen] = useState(false);
  const [panel, setPanel] = useState<'problem' | 'solution'>('problem');
  const [flowStep, setFlowStep] = useState<0 | 1 | 2>(0);
  const [trust, setTrust] = useState<0 | 1 | 2>(0);
  const [faqOpen, setFaqOpen] = useState<number | null>(0);

  const openBooking = (): void => {
    setBookingOpen(true);
  };

  return (
    <div className="mkt">
      <a href="#main" className="mkt-skip sr-only">
        Skip to content
      </a>

      <header className="mkt-header">
        <div className="mkt-wrap mkt-header-row">
          <a href="#main" className="mkt-logo">
            <LogoLockup />
          </a>
          <nav aria-label="Page sections" className="mkt-nav-links">
            {NAV.map((item) => (
              <a key={item.href} href={item.href}>
                {item.label}
              </a>
            ))}
            <Link href="/privacy">Privacy</Link>
          </nav>
          <div className="mkt-actions">
            <Link href="/sign-in" className="mkt-sign">
              Merchant sign in
            </Link>
            <button type="button" className="mkt-btn-outline" onClick={openBooking}>
              Book a Call
            </button>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="mkt-hero" aria-labelledby="hero-title">
          <div className="mkt-wrap">
            <div className="mkt-hero-frame">
              <img
                src="/marketing/hero-store.png"
                alt="A clothing boutique aisle with coats and shirts on open rails, daylight from a window."
                width={1600}
                height={900}
              />
              <div className="mkt-hero-scrim" aria-hidden="true" />
              <div className="mkt-hero-copy">
                <h1 id="hero-title">A fitting room on the Shopify product page.</h1>
                <p>
                  Two guided photos, a faceless avatar, and a size written to the cart when the check passes.
                </p>
                <button type="button" className="mkt-btn" onClick={openBooking}>
                  Book a Call
                </button>
              </div>
            </div>
          </div>
        </section>

        <div className="mkt-dark">
          <div className="mkt-wrap">
            <div className="mkt-ps">
              <button
                type="button"
                className={panel === 'problem' ? 'mkt-ps-panel is-open' : 'mkt-ps-panel is-shut'}
                data-kind="problem"
                aria-expanded={panel === 'problem'}
                onClick={() => setPanel('problem')}
              >
                <span className="mkt-ps-title">Problem</span>
                <span className="mkt-ps-body">
                  Wrong sizes start on the product page. Shoppers guess, buy two, and send one back. The page never shows how the garment sits.
                </span>
                <CornerArrow />
              </button>
              <button
                type="button"
                className={panel === 'solution' ? 'mkt-ps-panel is-open' : 'mkt-ps-panel is-shut'}
                data-kind="solution"
                aria-expanded={panel === 'solution'}
                onClick={() => setPanel('solution')}
              >
                <span className="mkt-ps-title">Solution</span>
                <span className="mkt-ps-body">
                  <span className="mkt-ps-kicker">Two photos, then a size.</span>
                  A guided front photo and a side photo. The head is cropped on the phone. A 3D avatar follows, and a size is written to the cart when the check passes.
                </span>
                <CornerArrow />
              </button>
            </div>

            <section className="mkt-features" aria-labelledby="features-title">
              <h2 id="features-title" className="mkt-section-title">
                Key features
              </h2>
              <div className="mkt-feature-grid">
                <article className="mkt-tile">
                  <h3>{FEATURES[0].title}</h3>
                  <p>{FEATURES[0].body}</p>
                </article>
                <article className="mkt-tile mkt-tile-ui">
                  <div>
                    <h3>{FEATURES[1].title}</h3>
                    <p>{FEATURES[1].body}</p>
                  </div>
                  <div className="mkt-mini" aria-hidden="true">
                    <div className="mkt-mini-figure">
                      <div className="mkt-mini-neck" />
                      <div className="mkt-mini-garment" />
                    </div>
                  </div>
                </article>
                <article className="mkt-tile mkt-tile-photo">
                  <img
                    src="/marketing/feature-coat.png"
                    alt="A charcoal wool coat on a wooden hanger against a plaster wall."
                    width={900}
                    height={1200}
                  />
                </article>
                <article className="mkt-tile mkt-tile-ui">
                  <div>
                    <h3>{FEATURES[2].title}</h3>
                    <p>{FEATURES[2].body}</p>
                  </div>
                  <div className="mkt-pills" aria-hidden="true">
                    <span className="mkt-pill-solid">Size M</span>
                    <span className="mkt-pill-line">Approximate fit</span>
                  </div>
                </article>
                <article className="mkt-tile">
                  <h3>{FEATURES[3].title}</h3>
                  <p>{FEATURES[3].body}</p>
                </article>
                <article className="mkt-tile mkt-tile-ui">
                  <div>
                    <h3>{FEATURES[4].title}</h3>
                    <p>{FEATURES[4].body}</p>
                  </div>
                  <div className="mkt-heat">
                    <span className="mkt-heat-swatch" aria-hidden="true" />
                    <span className="mkt-toggle" aria-hidden="true">
                      <span />
                    </span>
                  </div>
                  <p className="mkt-tile-note">
                    Clearance heatmap is a toggle. Loose reads blue. It does not set the size.
                  </p>
                </article>
              </div>
              <div className="mkt-feature-cta">
                <button type="button" className="mkt-btn" onClick={openBooking}>
                  Book a Call
                </button>
              </div>
            </section>

            <section id="product" className="mkt-product marketing-anchor" aria-labelledby="product-title">
              <div className="mkt-product-card">
                <div className="mkt-product-copy">
                  <h2 id="product-title">On the product page</h2>
                  <p>
                    The fitting room opens beside the garment. The avatar is faceless. The size is written to the cart when the gate passes.
                  </p>
                </div>
                <div className="mkt-product-visual">
                  <img
                    src="/marketing/product-rail.png"
                    alt="A rail of navy, sand, and black shirts and jackets in a shop."
                    width={1600}
                    height={900}
                  />
                  <ProductStage />
                </div>
              </div>
            </section>
          </div>
        </div>

        <section id="flow" className="mkt-light marketing-anchor" aria-labelledby="flow-title">
          <div className="mkt-wrap">
            <h2 id="flow-title" className="mkt-section-title">
              User flow
            </h2>
            <div className="mkt-flow-stage">
              {flowStep === 0 ? (
                <div className="mkt-flow-card">
                  <h3>{FLOW[0].title}</h3>
                  <ol>
                    <li>16 or older</li>
                    <li>Consent</li>
                    <li>Height and sex</li>
                    <li>Weight, optional</li>
                  </ol>
                </div>
              ) : null}
              {flowStep === 1 ? (
                <div className="mkt-flow-card">
                  <h3>{FLOW[1].title}</h3>
                  <div className="mkt-phones" aria-hidden="true">
                    <div className="mkt-phone">Front</div>
                    <div className="mkt-phone">Side</div>
                  </div>
                </div>
              ) : null}
              {flowStep === 2 ? (
                <div className="mkt-flow-card">
                  <h3>{FLOW[2].title}</h3>
                  <div className="mkt-mini" aria-hidden="true">
                    <div className="mkt-mini-figure">
                      <div className="mkt-mini-neck" />
                      <div className="mkt-mini-garment" />
                    </div>
                    <div className="mkt-pills">
                      <span className="mkt-pill-solid">Size M</span>
                      <span className="mkt-pill-line mkt-pill-line-ink">Approximate fit</span>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="mkt-flow-keys" role="tablist" aria-label="Shopper steps">
              {FLOW.map((step, index) => {
                const stepIndex = index as 0 | 1 | 2;
                const selected = flowStep === stepIndex;
                return (
                  <button
                    key={step.title}
                    type="button"
                    className={selected ? 'mkt-flow-key is-active' : 'mkt-flow-key'}
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setFlowStep(stepIndex)}
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>
            <p className="mkt-flow-caption">{FLOW[flowStep].caption}</p>
          </div>
        </section>

        <section className="mkt-shopify" aria-labelledby="shopify-title">
          <div className="mkt-wrap mkt-shopify-row">
            <h2 id="shopify-title" className="mkt-section-title">
              Shopify
            </h2>
            <div className="mkt-shopify-copy">
              <p>The fitting room is a Liquid block on the product page.</p>
              <p>When the confidence gate passes, the size is written to the cart. Otherwise the shopper sees Approximate fit.</p>
              <div className="mkt-page-frame">
                  <img
                    src="/marketing/feature-coat.png"
                    alt="The same charcoal coat, shown as the product photo."
                    width={120}
                    height={150}
                  />
                <div>
                  <h3>Wool coat</h3>
                  <p>Try on stays on this page.</p>
                  <span className="mkt-try">Try on</span>
                  <p className="mkt-frame-note">Size M is written to the cart when the gate passes.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="mkt-dark mkt-dark-late">
          <div className="mkt-wrap">
            <h2 className="mkt-section-title">Privacy, ease, and an honest size</h2>
            <div className="mkt-trust">
              {TRUST.map((item, index) => {
                const active = trust === index;
                return (
                  <button
                    key={item.title}
                    type="button"
                    className={active ? 'mkt-trust-card is-active' : 'mkt-trust-card is-idle'}
                    aria-expanded={active}
                    onClick={() => setTrust(index as 0 | 1 | 2)}
                  >
                    <span className="mkt-trust-title">{item.title}</span>
                    {active ? <p>{item.body}</p> : null}
                  </button>
                );
              })}
            </div>

            <section id="guarantee" className="mkt-guarantee marketing-anchor" aria-labelledby="guarantee-title">
              <h2 id="guarantee-title" className="mkt-section-title">
                The guarantee
              </h2>
              <div className="mkt-guarantee-grid">
                <article className="mkt-guarantee-card">
                  <p className="mkt-stat">15%</p>
                  <h3>Fewer returns, guaranteed.</h3>
                  <p>The commercial promise is a 15% reduction in return rate.</p>
                </article>
                <article className="mkt-guarantee-card">
                  <p className="mkt-stat">Up to 20%</p>
                  <h3>Conversion up to 20%.</h3>
                  <p>Shoppers who can see the fit are more ready to check out. The measured lift is up to 20%.</p>
                </article>
              </div>
            </section>

            <section className="mkt-close" aria-labelledby="close-title">
              <img
                src="/marketing/hero-store.png"
                alt=""
                width={1600}
                height={900}
              />
              <div className="mkt-close-scrim" aria-hidden="true" />
              <h2 id="close-title">Ready for fewer returns?</h2>
              <button type="button" className="mkt-btn-light" onClick={openBooking}>
                Book a Call
              </button>
            </section>
          </div>
        </div>

        <section className="mkt-faq" aria-labelledby="faq-title">
          <div className="mkt-wrap">
            <h2 id="faq-title" className="mkt-section-title">
              Frequently asked questions
            </h2>
            <div className="mkt-faq-list">
              {QUESTIONS.map((item, index) => {
                const open = faqOpen === index;
                return (
                  <div key={item.q} className="mkt-faq-item">
                    <h3>
                      <button
                        type="button"
                        className="mkt-faq-q"
                        aria-expanded={open}
                        onClick={() => setFaqOpen(open ? null : index)}
                      >
                        <span>{item.q}</span>
                        <svg
                          className={open ? 'mkt-plus is-open' : 'mkt-plus'}
                          width="22"
                          height="22"
                          viewBox="0 0 22 22"
                          aria-hidden="true"
                        >
                          <path d="M11 1v20M1 11h20" fill="none" stroke="currentColor" strokeWidth="1.5" />
                        </svg>
                      </button>
                    </h3>
                    <div className={open ? 'mkt-faq-a is-open' : 'mkt-faq-a'}>
                      <p>{item.a}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </main>

      <footer className="mkt-footer">
        <div className="mkt-wrap mkt-footer-row">
          <div>
            <a href="#main" className="mkt-logo">
              <LogoLockup />
            </a>
            <p>Virtual fitting room for Shopify merchants.</p>
          </div>
          <div className="mkt-footer-links">
            <Link href="/privacy">Privacy</Link>
            <Link href="/sign-in">Merchant sign in</Link>
          </div>
        </div>
      </footer>

      <BookCallDialog open={bookingOpen} onClose={() => setBookingOpen(false)} />
    </div>
  );
}
