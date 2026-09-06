'use server';

import { saveMerchantShopifyCredentials } from '@/lib/server/shopify-credentials';
import type { SaveShopifyCredentialsResult } from '@/lib/server/shopify-credentials';

export async function saveShopifyIntegration(
  shopDomainInput: string,
  adminTokenInput: string,
): Promise<SaveShopifyCredentialsResult> {
  return saveMerchantShopifyCredentials(shopDomainInput, adminTokenInput);
}
