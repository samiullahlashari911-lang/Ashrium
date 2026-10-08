'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ChangeEvent, type FormEvent } from 'react';

import { AshriumWordmark } from '@/components/brand/ashrium-logo';
import {
  MERCHANT_HOME_PATH,
  merchantPostAuthPath,
  tenantNeedsOnboarding,
} from '@/lib/onboarding';
import { createClient } from '@/lib/supabase/client';
import {
  merchantPortalErrorCopy,
  readMerchantPortalAccess,
} from '@/lib/supabase/merchant-access';

interface AuthFormProps {
  initialError: string | null;
}

export function AuthForm({ initialError }: AuthFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState(merchantPortalErrorCopy(initialError) ?? '');
  const [isError, setIsError] = useState(Boolean(merchantPortalErrorCopy(initialError)));
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setMessage('');
    setIsError(false);

    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setMessage(error.message);
        setIsError(true);
        return;
      }

      const access = await readMerchantPortalAccess(supabase);
      if (!access.allowed) {
        await supabase.auth.signOut();
        setMessage(
          merchantPortalErrorCopy(access.reason)
            ?? 'This email is not an invited Ashrium merchant.',
        );
        setIsError(true);
        return;
      }

      const { data: tenant } = await supabase
        .from('tenants')
        .select('allowed_domains')
        .eq('id', access.tenantId)
        .maybeSingle();

      router.replace(
        merchantPostAuthPath(
          MERCHANT_HOME_PATH,
          tenantNeedsOnboarding(tenant?.allowed_domains),
        ),
      );
      router.refresh();
    });
  };

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
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ash-accent">Merchant portal</p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-tight text-ash-ink">Welcome back</h1>
          <p className="mt-1 text-sm text-ash-muted">Sign in with the email your invite was sent to.</p>

          {message ? (
            <p
              role="status"
              className={`mt-5 rounded-xl px-3 py-2 text-sm ${isError ? 'bg-ash-tension-soft text-ash-tension' : 'bg-ash-success-soft text-ash-success'}`}
            >
              {message}
            </p>
          ) : null}

          <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ash-ink" htmlFor="merchant-email">
              Email
              <input
                id="merchant-email"
                required
                type="email"
                value={email}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)}
                autoComplete="email"
                placeholder="you@yourstore.com"
                aria-invalid={isError}
                className="ash-input font-normal"
              />
            </label>

            <label className="flex flex-col gap-1.5 text-sm font-medium text-ash-ink" htmlFor="merchant-password">
              Password
              <input
                id="merchant-password"
                required
                type="password"
                minLength={8}
                value={password}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="At least 8 characters"
                className="ash-input font-normal"
              />
            </label>

            <button type="submit" disabled={isPending} className="ash-cta mt-2 w-full py-3.5">
              {isPending ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-8 text-xs text-ash-subtle">
            Access is by invitation. <Link href="/" className="font-semibold text-ash-accent hover:underline">Back to ashrium.org</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
