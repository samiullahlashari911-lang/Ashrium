'use server';

import { revalidatePath } from 'next/cache';

import {
  MAX_ALLOWED_DOMAINS,
  merchantDomainFromOrigins,
  parseStorefrontOriginList,
} from '@/lib/onboarding';
import { createClient } from '@/lib/supabase/server';
import { requireCurrentTenantId } from '@/lib/supabase/tenant';

export interface TenantSettingsResult {
  domains: string[];
  message: string;
  success: boolean;
}

const SETTINGS_PATHS = ['/settings', '/onboarding', '/merchant/dashboard'] as const;

function isValidCompanyName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 160;
}

function revalidateMerchantSettings(): void {
  for (const path of SETTINGS_PATHS) {
    revalidatePath(path);
  }
}

export async function updateTenantCompanyName(companyName: string): Promise<TenantSettingsResult> {
  if (!isValidCompanyName(companyName)) {
    return {
      domains: [],
      message: 'Company name must be between 1 and 160 characters.',
      success: false,
    };
  }

  const tenantId = await requireCurrentTenantId();
  const supabase = await createClient();
  const trimmedName = companyName.trim();

  const { error: tenantError } = await supabase
    .from('tenants')
    .update({ company_name: trimmedName })
    .eq('id', tenantId);

  if (tenantError) {
    return {
      domains: [],
      message: 'Unable to update the company name.',
      success: false,
    };
  }

  const { error: merchantError } = await supabase
    .from('merchants')
    .update({ name: trimmedName })
    .eq('id', tenantId);

  if (merchantError) {
    return {
      domains: [],
      message: 'Company name was saved, but the merchant record could not be updated.',
      success: false,
    };
  }

  revalidateMerchantSettings();
  return {
    domains: [],
    message: 'Company name saved.',
    success: true,
  };
}

export async function replaceAllowedDomains(rawInputs: string[]): Promise<TenantSettingsResult> {
  const { invalid, origins } = parseStorefrontOriginList(rawInputs);

  if (invalid.length > 0) {
    return {
      domains: [],
      message: `Enter full storefront origins such as https://brand.myshopify.com. Invalid: ${invalid.join(', ')}`,
      success: false,
    };
  }

  if (origins.length > MAX_ALLOWED_DOMAINS) {
    return {
      domains: [],
      message: `At most ${MAX_ALLOWED_DOMAINS} storefront origins can be allowlisted.`,
      success: false,
    };
  }

  const tenantId = await requireCurrentTenantId();
  const supabase = await createClient();

  const { error: tenantError } = await supabase
    .from('tenants')
    .update({ allowed_domains: origins })
    .eq('id', tenantId);

  if (tenantError) {
    return {
      domains: [],
      message: 'Unable to update the domain allowlist.',
      success: false,
    };
  }

  const merchantDomain = merchantDomainFromOrigins(origins);
  if (merchantDomain) {
    const { error: merchantError } = await supabase
      .from('merchants')
      .update({ domain: merchantDomain })
      .eq('id', tenantId);

    if (merchantError) {
      return {
        domains: origins,
        message: 'Allowlist saved, but the merchant domain could not be updated.',
        success: false,
      };
    }
  }

  revalidateMerchantSettings();
  return {
    domains: origins,
    message: origins.length === 0
      ? 'Allowlist cleared. The storefront widget will not mint tokens until you add an origin.'
      : 'Storefront allowlist saved.',
    success: true,
  };
}
