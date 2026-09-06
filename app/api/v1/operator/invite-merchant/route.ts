import {
  isValidCompanyName,
  isValidMerchantInviteEmail,
  provisionContractedMerchant,
} from '@/lib/server/provision-merchant';
import { operatorSecretMatches, readOperatorSecret } from '@/lib/server/operator-secret';

export const runtime = 'nodejs';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readBearerSecret(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token.trim() || null;
}

export async function POST(request: Request): Promise<Response> {
  const expectedSecret = readOperatorSecret();
  if (!expectedSecret) {
    return Response.json({ code: 'OPERATOR_SECRET_UNCONFIGURED' }, { status: 503 });
  }

  const providedSecret = readBearerSecret(request);
  if (!providedSecret || !operatorSecretMatches(providedSecret, expectedSecret)) {
    return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  }

  if (!isRecord(payload) || typeof payload.email !== 'string' || typeof payload.companyName !== 'string') {
    return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  }

  if (!isValidMerchantInviteEmail(payload.email) || !isValidCompanyName(payload.companyName)) {
    return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  }

  const appBaseUrl = process.env.APP_BASE_URL?.trim();
  if (!appBaseUrl) {
    return Response.json({ code: 'APP_BASE_URL_MISSING' }, { status: 500 });
  }

  try {
    const result = await provisionContractedMerchant({
      email: payload.email,
      companyName: payload.companyName,
      redirectTo: `${appBaseUrl.replace(/\/$/, '')}/auth/callback?next=/merchant/dashboard`,
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invite failed.';
    return Response.json({ code: 'INVITE_FAILED', message }, { status: 500 });
  }
}
