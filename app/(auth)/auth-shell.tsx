import Image from 'next/image';
import type { ReactNode } from 'react';

import { AshriumWordmark } from '@/components/brand/ashrium-logo';

/** Sign-in, set-password and reset pages share this two-column layout. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen bg-ash-canvas lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-[radial-gradient(120%_80%_at_50%_10%,#ffffff_0%,#efeae2_75%)] p-10 lg:flex">
        <AshriumWordmark
          markClassName="h-8 w-8 shrink-0 text-ash-accent"
          wordClassName="text-base font-semibold tracking-tight text-ash-ink"
        />
        <div className="relative mx-auto h-[56vh] w-full max-w-md">
          <div className="relative h-full overflow-hidden rounded-[28px] border border-ash-line bg-ash-surface shadow-lift">
            <Image
              src="/marketing/signin-linen.webp"
              alt="A shopper in a sand linen shirt"
              fill
              sizes="448px"
              className="object-cover object-top"
              priority
            />
          </div>
          <div className="absolute bottom-8 left-0 -translate-x-6 rounded-2xl border border-ash-line bg-ash-surface/95 px-4 py-3 shadow-lift backdrop-blur">
            <p className="text-[11px] text-ash-muted">Recommended size</p>
            <div className="mt-1 flex items-center gap-3">
              <span className="text-2xl font-semibold leading-none text-ash-ink">M</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-ash-success px-2.5 py-1 text-[10px] font-semibold text-white">
                <svg viewBox="0 0 24 24" className="h-3 w-3" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Confident fit
              </span>
            </div>
          </div>
        </div>
        <div>
          <p className="text-2xl font-semibold leading-snug tracking-tight text-ash-ink">
            Your fitting room, your numbers.
          </p>
          <p className="mt-2 max-w-sm text-sm text-ash-muted">
            Products, try-ons, avatar times, and the return guarantee in one place.
          </p>
        </div>
      </aside>

      <section className="flex items-center justify-center px-6 py-16">
        <div className="ash-page-in w-full max-w-[380px]">
          <AshriumWordmark
            className="mb-10 lg:hidden"
            markClassName="h-8 w-8 shrink-0 text-ash-accent"
            wordClassName="text-base font-semibold tracking-tight text-ash-ink"
          />
          {children}
        </div>
      </section>
    </main>
  );
}

export function AuthNotice({ message, isError }: { message: string; isError: boolean }) {
  return (
    <p
      role="status"
      className={`mt-5 rounded-xl px-3 py-2 text-sm ${isError ? 'bg-ash-tension-soft text-ash-tension' : 'bg-ash-success-soft text-ash-success'}`}
    >
      {message}
    </p>
  );
}
