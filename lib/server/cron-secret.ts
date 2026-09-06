import { timingSafeEqual } from 'node:crypto';

export function readCronSecret(): string | null {
  const secret = process.env.CRON_SECRET?.trim() ?? '';
  return secret.length >= 16 ? secret : null;
}

export function cronSecretMatches(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export function readBearerSecret(request: Request): string | null {
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

/** Returns a 503/401 response when the cron bearer is missing or wrong. */
export function authorizeCronRequest(request: Request): Response | null {
  const expectedSecret = readCronSecret();
  if (!expectedSecret) {
    return Response.json({ code: 'CRON_SECRET_UNCONFIGURED' }, { status: 503 });
  }

  const providedSecret = readBearerSecret(request);
  if (!providedSecret || !cronSecretMatches(providedSecret, expectedSecret)) {
    return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  }

  return null;
}
