'use client';

import { useActionState, useState, type ChangeEvent } from 'react';

import { AuthNotice } from '@/app/(auth)/auth-shell';
import { MERCHANT_PASSWORD_MIN } from '@/lib/auth/password-policy';
import { completePasswordSetup, type PasswordSetupState } from '@/lib/server/account-actions';
import type { MerchantAuthLinkType } from '@/lib/server/auth-links';

interface SetPasswordFormProps {
  type: MerchantAuthLinkType;
  tokenHash: string;
  submitLabel: string;
}

const INITIAL_STATE: PasswordSetupState = { error: null };

export function SetPasswordForm({ type, tokenHash, submitLabel }: SetPasswordFormProps) {
  const [state, formAction, isPending] = useActionState(completePasswordSetup, INITIAL_STATE);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const longEnough = password.length >= MERCHANT_PASSWORD_MIN;

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-4">
      {state.error ? <AuthNotice message={state.error} isError /> : null}
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="token_hash" value={tokenHash} />

      <label className="flex flex-col gap-1.5 text-sm font-medium text-ash-ink" htmlFor="new-password">
        New password
        <input
          id="new-password"
          name="password"
          required
          type={show ? 'text' : 'password'}
          minLength={MERCHANT_PASSWORD_MIN}
          maxLength={72}
          value={password}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)}
          autoComplete="new-password"
          placeholder={`At least ${MERCHANT_PASSWORD_MIN} characters`}
          className="ash-input font-normal"
        />
      </label>
      <p className={`-mt-2 text-xs ${longEnough ? 'text-ash-success' : 'text-ash-subtle'}`}>
        {longEnough ? 'Length looks good.' : `${password.length} / ${MERCHANT_PASSWORD_MIN} characters. A short phrase works well.`}
      </p>

      <label className="flex flex-col gap-1.5 text-sm font-medium text-ash-ink" htmlFor="confirm-password">
        Type it again
        <input
          id="confirm-password"
          name="confirm"
          required
          type={show ? 'text' : 'password'}
          maxLength={72}
          autoComplete="new-password"
          className="ash-input font-normal"
        />
      </label>

      <label className="flex items-center gap-2 text-sm text-ash-muted">
        <input type="checkbox" checked={show} onChange={(event) => setShow(event.target.checked)} />
        Show passwords
      </label>

      <button type="submit" disabled={isPending} className="ash-cta mt-2 w-full py-3.5">
        {isPending ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
