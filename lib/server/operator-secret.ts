import { timingSafeEqual } from 'node:crypto';

export function readOperatorSecret(): string | null {
  const secret = process.env.ASHRIUM_OPERATOR_SECRET?.trim() ?? '';
  return secret.length >= 16 ? secret : null;
}

export function operatorSecretMatches(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}
