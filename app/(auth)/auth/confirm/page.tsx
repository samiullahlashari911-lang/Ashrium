import Link from 'next/link';

import { AuthNotice, AuthShell } from '@/app/(auth)/auth-shell';
import { SetPasswordForm } from '@/app/(auth)/auth/confirm/set-password-form';
import { isMerchantAuthLinkType } from '@/lib/server/auth-links';

interface ConfirmPageProps {
  searchParams: Promise<{ type?: string; token_hash?: string }>;
}

export const dynamic = 'force-dynamic';

/** Landing page for invite and reset emails. Nothing is verified on GET. */
export default async function ConfirmPage({ searchParams }: ConfirmPageProps) {
  const { type, token_hash: tokenHash } = await searchParams;

  if (!isMerchantAuthLinkType(type) || !tokenHash) {
    return (
      <AuthShell>
        <h1 className="text-[30px] font-semibold tracking-tight text-ash-ink">Link not valid</h1>
        <AuthNotice
          isError
          message="This link is incomplete. Open it again from your email, or ask for a new one."
        />
        <Link href="/forgot-password" className="ash-cta mt-8 block w-full py-3.5 text-center">
          Get a new link
        </Link>
      </AuthShell>
    );
  }

  const isInvite = type === 'invite';
  return (
    <AuthShell>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ash-accent">
        {isInvite ? 'Welcome to Ashrium' : 'Merchant portal'}
      </p>
      <h1 className="mt-2 text-[30px] font-semibold tracking-tight text-ash-ink">
        {isInvite ? 'Set your password' : 'Choose a new password'}
      </h1>
      <p className="mt-1 text-sm text-ash-muted">
        {isInvite
          ? 'You will use it with this email to sign in. Next, you connect your Shopify store.'
          : 'You will be signed in as soon as it is saved.'}
      </p>
      <SetPasswordForm type={type} tokenHash={tokenHash} submitLabel={isInvite ? 'Set password and continue' : 'Save new password'} />
    </AuthShell>
  );
}
