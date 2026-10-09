import type { AccountEmail } from '@/lib/server/auth-links';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Ashrium <no-reply@ashrium.org>';

export class EmailNotConfiguredError extends Error {
  constructor() {
    super('RESEND_API_KEY is not set, so account emails cannot be sent.');
    this.name = 'EmailNotConfiguredError';
  }
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

/** Sends one transactional email through Resend's HTTP API (no SDK). */
export async function sendAccountEmail(to: string, email: AccountEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new EmailNotConfiguredError();
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.ASHRIUM_EMAIL_FROM?.trim() || DEFAULT_FROM,
      to: [to],
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Resend refused the email (${response.status}): ${detail}`);
  }
}
