'use server';

import { createCipheriv, randomBytes } from 'node:crypto';

import { requireCurrentTenantId } from '@/lib/supabase/tenant';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export interface SaveMerchantReplicateKeyResult {
  maskedKey: string;
  message: string;
  success: boolean;
}

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

function encryptApiKey(apiKey: string): string {
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), initializationVector);
  const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    'v1',
    initializationVector.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

function maskReplicateApiKey(): string {
  return 'r8_...****';
}

async function validateReplicateApiKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch('https://api.replicate.com/v1/account', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      cache: 'no-store',
    });

    return response.ok;
  } catch {
    return false;
  }
}

export async function saveMerchantReplicateKey(
  apiKey: string,
): Promise<SaveMerchantReplicateKeyResult> {
  const normalizedApiKey = apiKey.trim();

  if (
    !normalizedApiKey.startsWith('r8_') ||
    normalizedApiKey.length < 12 ||
    normalizedApiKey.length > 256
  ) {
    return {
      maskedKey: '',
      message: 'Enter a valid Replicate API key.',
      success: false,
    };
  }

  const tenantId = await requireCurrentTenantId();
  const tenantClient = await createClient();
  const { data: merchant, error: merchantError } = await tenantClient
    .from('merchants')
    .select('plan_tier')
    .eq('id', tenantId)
    .maybeSingle();

  if (merchantError || !merchant) {
    return {
      maskedKey: '',
      message: 'Unable to verify the tenant subscription.',
      success: false,
    };
  }

  if (merchant.plan_tier !== 'enterprise') {
    return {
      maskedKey: '',
      message: 'Replicate BYOK is available only on Enterprise plans.',
      success: false,
    };
  }

  const isValid = await validateReplicateApiKey(normalizedApiKey);
  if (!isValid) {
    return {
      maskedKey: '',
      message: 'Replicate could not validate this API key.',
      success: false,
    };
  }

  const serviceClient = createServiceClient();
  const { error: saveError } = await serviceClient
    .from('tenant_integrations')
    .upsert(
      {
        tenant_id: tenantId,
        provider: 'replicate',
        replicate_api_key_ciphertext: encryptApiKey(normalizedApiKey),
        is_active: true,
      },
      { onConflict: 'tenant_id,provider' },
    );

  if (saveError) {
    return {
      maskedKey: '',
      message: 'Unable to save the Replicate integration.',
      success: false,
    };
  }

  return {
    maskedKey: maskReplicateApiKey(),
    message: 'Replicate key saved and activated.',
    success: true,
  };
}
