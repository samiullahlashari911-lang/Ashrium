import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { createServiceClient } from '@/lib/supabase/service';
import { requireCurrentTenantId } from '@/lib/supabase/tenant';

const MAX_WEBHOOK_AGE_MS = 5 * 60 * 1000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getEncryptionKey(): Buffer {
  const encodedKey = process.env.TENANT_KEY_ENCRYPTION_KEY?.trim();
  if (!encodedKey) {
    throw new Error('TENANT_KEY_ENCRYPTION_KEY is not configured.');
  }

  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32) {
    throw new Error('TENANT_KEY_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }

  return key;
}

function encryptSecret(secret: string): string {
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), initializationVector);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    'v1',
    initializationVector.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

function decryptSecret(ciphertext: string): string | null {
  const [version, initializationVector, authTag, encryptedSecret, ...extraParts] = ciphertext.split('.');
  if (
    version !== 'v1'
    || !initializationVector
    || !authTag
    || !encryptedSecret
    || extraParts.length > 0
  ) {
    return null;
  }

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      getEncryptionKey(),
      Buffer.from(initializationVector, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(authTag, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(encryptedSecret, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

function hasValidSignature(expectedSignature: string, receivedSignature: string): boolean {
  const expected = Buffer.from(expectedSignature, 'hex');
  const received = Buffer.from(receivedSignature, 'hex');

  return expected.length === received.length && timingSafeEqual(expected, received);
}

export interface TelemetryWebhookSecret {
  secret: string;
  tenantId: string;
}

export async function provisionTelemetryWebhookSecret(): Promise<TelemetryWebhookSecret> {
  const tenantId = await requireCurrentTenantId();
  const secret = randomBytes(32).toString('base64url');
  const serviceClient = createServiceClient();
  const { error } = await serviceClient.from('tenant_integrations').upsert(
    {
      tenant_id: tenantId,
      provider: 'telemetry',
      telemetry_webhook_secret_ciphertext: encryptSecret(secret),
      is_active: true,
    },
    { onConflict: 'tenant_id,provider' },
  );

  if (error) {
    throw new Error('Unable to provision telemetry webhook credentials.');
  }

  return { secret, tenantId };
}

export async function verifyTelemetryWebhook(
  body: string,
  headers: Headers,
): Promise<string | null> {
  const tenantId = headers.get('x-ashrium-tenant-id')?.trim();
  const timestamp = headers.get('x-ashrium-timestamp')?.trim();
  const signature = headers.get('x-ashrium-signature')?.trim().toLowerCase();

  if (
    !tenantId
    || !UUID_PATTERN.test(tenantId)
    || !timestamp
    || !/^\d{13}$/.test(timestamp)
    || !signature
    || !/^[0-9a-f]{64}$/.test(signature)
  ) {
    return null;
  }

  if (Math.abs(Date.now() - Number(timestamp)) > MAX_WEBHOOK_AGE_MS) {
    return null;
  }

  const serviceClient = createServiceClient();
  const { data: integration, error } = await serviceClient
    .from('tenant_integrations')
    .select('telemetry_webhook_secret_ciphertext')
    .eq('tenant_id', tenantId)
    .eq('provider', 'telemetry')
    .eq('is_active', true)
    .maybeSingle();

  const secret = !error && integration?.telemetry_webhook_secret_ciphertext
    ? decryptSecret(integration.telemetry_webhook_secret_ciphertext)
    : null;

  if (!secret) {
    return null;
  }

  const expectedSignature = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  return hasValidSignature(expectedSignature, signature) ? tenantId : null;
}
