'use server';

import {
  disconnectMerchantShopify,
  saveMerchantShopifyCredentials,
} from '@/lib/server/shopify-credentials';
import type {
  DisconnectShopifyResult,
  SaveShopifyCredentialsResult,
} from '@/lib/server/shopify-credentials';

export async function saveShopifyIntegration(
  shopDomainInput: string,
  adminTokenInput: string,
): Promise<SaveShopifyCredentialsResult> {
  return saveMerchantShopifyCredentials(shopDomainInput, adminTokenInput);
}

export async function disconnectShopifyIntegration(): Promise<DisconnectShopifyResult> {
  return disconnectMerchantShopify();
}
