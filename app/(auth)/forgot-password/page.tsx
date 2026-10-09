import Link from 'next/link';

import { AuthShell } from '@/app/(auth)/auth-shell';
import { ForgotPasswordForm } from '@/app/(auth)/forgot-password/forgot-password-form';

export default function ForgotPasswordPage() {
  return (
    <AuthShell>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ash-accent">Merchant portal</p>
      <h1 className="mt-2 text-[30px] font-semibold tracking-tight text-ash-ink">Reset your password</h1>
      <p className="mt-1 text-sm text-ash-muted">
        Enter the email you sign in with. We will send a link to choose a new password.
      </p>
      <ForgotPasswordForm />
      <p className="mt-8 text-xs text-ash-subtle">
        Remembered it? <Link href="/sign-in" className="font-semibold text-ash-accent hover:underline">Back to sign in</Link>
      </p>
    </AuthShell>
  );
}
