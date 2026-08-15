import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_WEBHOOK_AGE_SECONDS = 5 * 60;

export interface ReplicateWebhookEvent {
  id: string;
  status: string;
  output: unknown;
  error: string | null;
}

function getWebhookSecret(): Buffer {
  const secret = process.env.REPLICATE_WEBHOOK_SIGNING_SECRET?.trim();

  if (!secret?.startsWith('whsec_')) {
    throw new Error('REPLICATE_WEBHOOK_SIGNING_SECRET must start with "whsec_".');
  }

  return Buffer.from(secret.slice('whsec_'.length), 'base64');
}

function isWebhookEvent(value: unknown): value is ReplicateWebhookEvent {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const event = value as Record<string, unknown>;
  return (
    typeof event.id === 'string' &&
    typeof event.status === 'string' &&
    (event.error === null || event.error === undefined || typeof event.error === 'string')
  );
}

function matchesSignature(expected: Buffer, signatures: string): boolean {
  return signatures.split(' ').some((signature) => {
    const [, encodedSignature] = signature.split(',', 2);

    if (!encodedSignature) {
      return false;
    }

    const provided = Buffer.from(encodedSignature, 'base64');
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  });
}

export function verifyReplicateWebhook(
  body: string,
  headers: Headers,
): ReplicateWebhookEvent | null {
  const webhookId = headers.get('webhook-id');
  const timestamp = headers.get('webhook-timestamp');
  const signatures = headers.get('webhook-signature');

  if (!webhookId || !timestamp || !signatures) {
    return null;
  }

  const timestampSeconds = Number(timestamp);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > MAX_WEBHOOK_AGE_SECONDS
  ) {
    return null;
  }

  const expected = createHmac('sha256', getWebhookSecret())
    .update(`${webhookId}.${timestamp}.${body}`)
    .digest();

  if (!matchesSignature(expected, signatures)) {
    return null;
  }

  try {
    const payload: unknown = JSON.parse(body);
    if (!isWebhookEvent(payload)) {
      return null;
    }

    return {
      id: payload.id,
      status: payload.status,
      output: payload.output,
      error: typeof payload.error === 'string' ? payload.error : null,
    };
  } catch {
    return null;
  }
}
