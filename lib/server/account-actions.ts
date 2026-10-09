'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { merchantPasswordProblem } from '@/lib/auth/password-policy';
import { MERCHANT_HOME_PATH, merchantPostAuthPath, tenantNeedsOnboarding } from '@/lib/onboarding';
import {
  buildAuthConfirmUrl,
  isMerchantAuthLinkType,
  passwordResetEmail,
  readAppBaseUrl,
} from '@/lib/server/auth-links';
import { consumeRateLimit } from '@/lib/server/durable-rate-limit';
import { isEmailConfigured, sendAccountEmail } from '@/lib/server/email';
import { isValidMerchantInviteEmail } from '@/lib/server/provision-merchant';
import {
  merchantPortalErrorCopy,
  readMerchantPortalAccess,
} from '@/lib/supabase/merchant-access';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const HOUR_MS = 60 * 60 * 1000;
const RESET_REQUESTS_PER_IP_PER_HOUR = 5;
const RESET_REQUESTS_PER_EMAIL_PER_HOUR = 3;

export interface PasswordSetupState {
  error: string | null;
}

const EXPIRED_LINK_COPY =
  'This link has expired or was already used. Ask for a new one from the sign-in page ("Forgot password?").';

/**
 * Invite and reset links land on /auth/confirm. The token is verified only
 * here, on submit, so link scanners that open the page do not burn it.
 */
export async function completePasswordSetup(
  _previous: PasswordSetupState,
  formData: FormData,
): Promise<PasswordSetupState> {
  const type = formData.get('type');
  const tokenHash = formData.get('token_hash');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (
    !isMerchantAuthLinkType(type)
    || typeof tokenHash !== 'string'
    || tokenHash.length < 10
    || tokenHash.length > 200
  ) {
    return { error: EXPIRED_LINK_COPY };
  }

  const problem = merchantPasswordProblem(password, confirm);
  if (problem) {
    return { error: problem };
  }

  const supabase = await createClient();
  // A previous submit may have verified the token and then had the password
  // refused (e.g. a leaked password). The session from that verify still holds.
  const { data: existing } = await supabase.auth.getUser();
  if (!existing.user) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) {
      return { error: EXPIRED_LINK_COPY };
    }
  }

  const access = await readMerchantPortalAccess(supabase);
  if (!access.allowed) {
    await supabase.auth.signOut();
    return {
      error: merchantPortalErrorCopy(access.reason) ?? 'This email is not an invited Ashrium merchant.',
    };
  }

  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) {
    return { error: updateError.message };
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('allowed_domains')
    .eq('id', access.tenantId)
    .maybeSingle();

  redirect(merchantPostAuthPath(MERCHANT_HOME_PATH, tenantNeedsOnboarding(tenant?.allowed_domains)));
}

export interface PasswordResetState {
  status: 'idle' | 'sent' | 'error';
  message: string | null;
}

const RESET_SENT_COPY =
  'If that email belongs to an Ashrium merchant, a reset link is on its way. It works once and expires in 1 hour.';

async function readRequestIp(): Promise<string> {
  const headerList = await headers();
  return headerList.get('x-forwarded-for')?.split(',')[0]?.trim()
    || headerList.get('x-real-ip')?.trim()
    || 'unknown';
}

/** Always answers the same way so the form cannot be used to find accounts. */
export async function requestPasswordReset(
  _previous: PasswordResetState,
  formData: FormData,
): Promise<PasswordResetState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (!isValidMerchantInviteEmail(email)) {
    return { status: 'error', message: 'Enter the email address you sign in with.' };
  }

  const [ipLimit, emailLimit] = await Promise.all([
    consumeRateLimit(`pw-reset-ip:${await readRequestIp()}`, RESET_REQUESTS_PER_IP_PER_HOUR, HOUR_MS),
    consumeRateLimit(`pw-reset:${email}`, RESET_REQUESTS_PER_EMAIL_PER_HOUR, HOUR_MS),
  ]);
  if (!ipLimit.allowed || !emailLimit.allowed) {
    return { status: 'error', message: 'Too many reset requests. Try again in an hour.' };
  }

  if (!isEmailConfigured()) {
    return {
      status: 'error',
      message: 'Password reset by email is not switched on yet. Contact Ashrium and we will reset it for you.',
    };
  }

  const service = createServiceClient();
  const { data, error } = await service.auth.admin.generateLink({ type: 'recovery', email });
  const hashedToken = data?.properties?.hashed_token;
  const userId = data?.user?.id;
  if (error || typeof hashedToken !== 'string' || !userId) {
    return { status: 'sent', message: RESET_SENT_COPY };
  }

  const { data: tenant } = await service
    .from('tenants')
    .select('status')
    .eq('owner_user_id', userId)
    .maybeSingle();
  if (tenant?.status !== 'active') {
    return { status: 'sent', message: RESET_SENT_COPY };
  }

  try {
    const link = buildAuthConfirmUrl(readAppBaseUrl(), 'recovery', hashedToken);
    await sendAccountEmail(email, passwordResetEmail(link));
  } catch (sendError) {
    console.error('[password-reset] email failed', sendError instanceof Error ? sendError.message : sendError);
  }

  return { status: 'sent', message: RESET_SENT_COPY };
}
