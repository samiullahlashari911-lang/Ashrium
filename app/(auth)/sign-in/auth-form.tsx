'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type ChangeEvent, type FormEvent } from 'react';

import { createClient } from '@/lib/supabase/client';

type AuthMode = 'sign-in' | 'sign-up';

interface AuthFormValues {
  companyName: string;
  email: string;
  password: string;
}

const INITIAL_FORM_VALUES: AuthFormValues = {
  companyName: '',
  email: '',
  password: '',
};

export function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [formValues, setFormValues] = useState<AuthFormValues>(INITIAL_FORM_VALUES);
  const [message, setMessage] = useState<string>('');
  const [isError, setIsError] = useState(false);
  const [isPending, startTransition] = useTransition();

  const updateField = <K extends keyof AuthFormValues>(
    field: K,
    event: ChangeEvent<HTMLInputElement>,
  ): void => {
    setFormValues((current) => ({ ...current, [field]: event.target.value }));
  };

  const handleModeChange = (nextMode: AuthMode): void => {
    setMode(nextMode);
    setMessage('');
    setIsError(false);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setMessage('');
    setIsError(false);

    startTransition(async () => {
      const supabase = createClient();
      const email = formValues.email.trim();
      const password = formValues.password;

      if (mode === 'sign-up') {
        const companyName = formValues.companyName.trim();
        if (!companyName) {
          setMessage('Company name is required to create a merchant account.');
          setIsError(true);
          return;
        }

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { company_name: companyName },
            emailRedirectTo: `${window.location.origin}/auth/callback?next=/merchant/dashboard`,
          },
        });

        if (error) {
          setMessage(error.message);
          setIsError(true);
          return;
        }

        if (data.session) {
          await supabase.auth.refreshSession();
          router.replace('/merchant/dashboard');
          router.refresh();
          return;
        }

        setMessage('Check your email to confirm your account and finish sign-in.');
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        setMessage(error.message);
        setIsError(true);
        return;
      }

      router.replace('/merchant/dashboard');
      router.refresh();
    });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <section className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-2xl backdrop-blur">
        <p className="text-sm font-medium text-sky-300">Ashrium Merchant Portal</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-100">
          {mode === 'sign-in' ? 'Sign in to your workspace' : 'Create a merchant workspace'}
        </h1>

        <div className="mt-6 grid grid-cols-2 rounded-lg border border-slate-800 bg-slate-950/60 p-1">
          {(['sign-in', 'sign-up'] as const).map((candidateMode) => (
            <button
              key={candidateMode}
              type="button"
              onClick={() => handleModeChange(candidateMode)}
              className={[
                'rounded-md px-3 py-2 text-sm font-semibold transition-colors',
                mode === candidateMode
                  ? 'bg-sky-500/20 text-sky-100'
                  : 'text-slate-400 hover:text-slate-100',
              ].join(' ')}
            >
              {candidateMode === 'sign-in' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          {mode === 'sign-up' ? (
            <label className="flex flex-col gap-1.5 text-sm text-slate-300">
              Company name
              <input
                required
                value={formValues.companyName}
                onChange={(event) => updateField('companyName', event)}
                autoComplete="organization"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none transition focus:border-sky-400"
              />
            </label>
          ) : null}

          <label className="flex flex-col gap-1.5 text-sm text-slate-300">
            Work email
            <input
              required
              type="email"
              value={formValues.email}
              onChange={(event) => updateField('email', event)}
              autoComplete="email"
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none transition focus:border-sky-400"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm text-slate-300">
            Password
            <input
              required
              type="password"
              minLength={8}
              value={formValues.password}
              onChange={(event) => updateField('password', event)}
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none transition focus:border-sky-400"
            />
          </label>

          {message ? (
            <p className={`text-sm ${isError ? 'text-red-300' : 'text-emerald-300'}`}>{message}</p>
          ) : null}

          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending
              ? 'Working…'
              : mode === 'sign-in'
                ? 'Sign in'
                : 'Create merchant account'}
          </button>
        </form>
      </section>
    </main>
  );
}
