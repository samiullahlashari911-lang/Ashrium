'use client';

import { useActionState } from 'react';

import { AuthNotice } from '@/app/(auth)/auth-shell';
import { requestPasswordReset, type PasswordResetState } from '@/lib/server/account-actions';

const INITIAL_STATE: PasswordResetState = { status: 'idle', message: null };

export function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState(requestPasswordReset, INITIAL_STATE);

  if (state.status === 'sent' && state.message) {
    return <AuthNotice message={state.message} isError={false} />;
  }

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-4">
      {state.message ? <AuthNotice message={state.message} isError /> : null}
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ash-ink" htmlFor="reset-email">
        Email
        <input
          id="reset-email"
          name="email"
          required
          type="email"
          autoComplete="email"
          placeholder="you@yourstore.com"
          className="ash-input font-normal"
        />
      </label>
      <button type="submit" disabled={isPending} className="ash-cta mt-2 w-full py-3.5">
        {isPending ? 'Sending…' : 'Send reset link'}
      </button>
    </form>
  );
}
