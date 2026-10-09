/**
 * Merchant account links: invite and password reset. Supabase's own action
 * link returns the session in the URL fragment, which a server route cannot
 * read, so we mint `hashed_token` server-side and verify it on our own page.
 * The page only verifies on a button press, so email link scanners that open
 * the URL do not burn the token.
 */
export type MerchantAuthLinkType = 'invite' | 'recovery';

export function isMerchantAuthLinkType(value: unknown): value is MerchantAuthLinkType {
  return value === 'invite' || value === 'recovery';
}

export function buildAuthConfirmUrl(
  appBaseUrl: string,
  type: MerchantAuthLinkType,
  hashedToken: string,
): string {
  const url = new URL('/auth/confirm', appBaseUrl);
  url.searchParams.set('type', type);
  url.searchParams.set('token_hash', hashedToken);
  return url.toString();
}

export function readAppBaseUrl(): string {
  const base = process.env.APP_BASE_URL?.trim();
  if (!base) {
    throw new Error('APP_BASE_URL is required to build account links.');
  }
  return base.replace(/\/$/, '');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export interface AccountEmail {
  subject: string;
  html: string;
  text: string;
}

function accountEmail(input: {
  subject: string;
  heading: string;
  body: string;
  cta: string;
  link: string;
  footer: string;
}): AccountEmail {
  const link = escapeHtml(input.link);
  const html = `<!doctype html><html><body style="margin:0;background:#F4F1EC;font-family:Inter,Segoe UI,Arial,sans-serif;color:#1D1B22">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #E6E1D9;border-radius:20px;padding:32px">
<tr><td style="font-size:15px;font-weight:600;color:#6A4CF5">Ashrium</td></tr>
<tr><td style="padding-top:20px;font-size:22px;font-weight:600">${escapeHtml(input.heading)}</td></tr>
<tr><td style="padding-top:10px;font-size:14px;line-height:1.6;color:#6B6775">${escapeHtml(input.body)}</td></tr>
<tr><td style="padding-top:24px"><a href="${link}" style="display:inline-block;background:#6A4CF5;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:999px">${escapeHtml(input.cta)}</a></td></tr>
<tr><td style="padding-top:24px;font-size:12px;line-height:1.6;color:#8a8492">${escapeHtml(input.footer)}<br><span style="word-break:break-all">${link}</span></td></tr>
</table></td></tr></table></body></html>`;
  const text = `${input.heading}\n\n${input.body}\n\n${input.cta}: ${input.link}\n\n${input.footer}`;
  return { subject: input.subject, html, text };
}

export function inviteEmail(companyName: string, link: string): AccountEmail {
  return accountEmail({
    subject: 'Your Ashrium merchant account is ready',
    heading: `Welcome to Ashrium, ${companyName}`,
    body: 'Your virtual fitting room account is ready. Set a password to sign in, then connect your Shopify store. Your products are brought in automatically.',
    cta: 'Set your password',
    link,
    footer: 'This link works once and expires in 24 hours. If you did not expect this email, you can ignore it.',
  });
}

export function passwordResetEmail(link: string): AccountEmail {
  return accountEmail({
    subject: 'Reset your Ashrium password',
    heading: 'Reset your password',
    body: 'Someone asked to reset the password for this Ashrium merchant account. If it was you, choose a new password below.',
    cta: 'Choose a new password',
    link,
    footer: 'This link works once and expires in 1 hour. If you did not ask for this, ignore this email and your password stays the same.',
  });
}
