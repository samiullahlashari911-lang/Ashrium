'use server';

import { encryptTenantSecret } from '@/lib/server/secret-crypto';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { requireCurrentTenantId } from '@/lib/supabase/tenant';

export interface SaveMerchantReplicateKeyResult {
  maskedKey: string;
  message: string;
  success: boolean;
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
        replicate_api_key_ciphertext: encryptTenantSecret(normalizedApiKey),
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
