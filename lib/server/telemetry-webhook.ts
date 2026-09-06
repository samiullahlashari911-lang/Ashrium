import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { decryptTenantSecret, encryptTenantSecret } from '@/lib/server/secret-crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { requireCurrentTenantId } from '@/lib/supabase/tenant';

const MAX_WEBHOOK_AGE_MS = 5 * 60 * 1000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      telemetry_webhook_secret_ciphertext: encryptTenantSecret(secret),
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
    ? decryptTenantSecret(integration.telemetry_webhook_secret_ciphertext)
    : null;

  if (!secret) {
    return null;
  }

  const expectedSignature = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  return hasValidSignature(expectedSignature, signature) ? tenantId : null;
}
