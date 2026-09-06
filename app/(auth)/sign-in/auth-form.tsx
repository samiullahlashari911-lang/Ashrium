'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type ChangeEvent, type FormEvent } from 'react';

import { AshriumWordmark } from '@/components/brand/ashrium-logo';
import { AtmosphereBackdrop } from '@/components/theme/atmosphere-backdrop';
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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-16">
      <AtmosphereBackdrop intensity="hero" />

      <AshriumWordmark
        className="absolute left-8 top-7 z-20 text-white"
        markClassName="h-8 w-8 shrink-0"
        wordClassName="text-sm font-medium tracking-[0.04em] text-white"
      />

      <section className="obsidian-glass relative z-10 w-full max-w-[400px] px-8 py-8">
        <div className="pointer-events-none mb-8 flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-[#4A2880]" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
        </div>

        <h1 className="text-[2rem] font-bold tracking-tight text-white">Merchant Portal</h1>
        <p className="mt-2 text-base font-normal text-white/80">Sign in to your account</p>

        {message ? (
          <p
            role="status"
            className={`mt-4 text-sm ${isError ? 'text-rose-300' : 'text-emerald-300'}`}
          >
            {message}
          </p>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
          <label className="sr-only" htmlFor="merchant-email">
            Email
          </label>
          <input
            id="merchant-email"
            required
            type="email"
            value={email}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)}
            autoComplete="email"
            placeholder="Email Address"
            aria-invalid={isError}
            className="obsidian-input"
          />

          <label className="sr-only" htmlFor="merchant-password">
            Password
          </label>
          <input
            id="merchant-password"
            required
            type="password"
            minLength={8}
            value={password}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)}
            autoComplete="current-password"
            placeholder="Password"
            className="obsidian-input"
          />

          <button type="submit" disabled={isPending} className="obsidian-cta mt-2 w-full">
            {isPending ? 'Signing in…' : 'Log In'}
          </button>
        </form>
      </section>

      <p className="absolute bottom-6 z-20 text-[11px] tracking-wide text-white/35">
        Authorized by Ashrium
      </p>
    </main>
  );
}
