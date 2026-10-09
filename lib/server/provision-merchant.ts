import { buildAuthConfirmUrl, inviteEmail } from '@/lib/server/auth-links';
import { sendAccountEmail } from '@/lib/server/email';
import { encryptTenantSecret } from '@/lib/server/secret-crypto';
import { createServiceClient } from '@/lib/supabase/service';

const OPERATOR_INVITE_MARK = 'ashrium_operator';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ProvisionMerchantInput {
  email: string;
  companyName: string;
  /** e.g. https://www.ashrium.org — the invite opens /auth/confirm there. */
  appBaseUrl: string;
  /** The client's own custom-distribution Shopify app (npm run client:new). */
  shopifyApp?: ClientShopifyAppInput;
}

export interface ClientShopifyAppInput {
  clientId: string;
  clientSecret: string;
  shopDomain: string;
  installUrl: string;
}

const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/** Plain-language problem with a client app registration, or null. */
export function clientShopifyAppProblem(app: ClientShopifyAppInput): string | null {
  if (!/^[a-f0-9]{32}$/i.test(app.clientId.trim())) {
    return 'The Shopify Client ID should be 32 letters and digits (Dev Dashboard → app → Settings).';
  }
  if (app.clientSecret.trim().length < 20) {
    return 'The Shopify Client secret looks too short.';
  }
  if (!SHOP_DOMAIN_PATTERN.test(app.shopDomain.trim().toLowerCase())) {
    return 'The store must be its *.myshopify.com address.';
  }
  let install: URL;
  try {
    install = new URL(app.installUrl.trim());
  } catch {
    return 'The install link is not a valid URL.';
  }
  if (install.protocol !== 'https:' || !/(^|\.)shopify\.com$/i.test(install.hostname)) {
    return 'The install link should be the https://…shopify.com link from Dev Dashboard → Distribution.';
  }
  return null;
}

export interface ProvisionMerchantResult {
  tenantId: string;
  userId: string;
  inviteLink: string | null;
  /** True when the invite email went out; otherwise send `inviteLink` yourself. */
  inviteEmailSent: boolean;
  inviteEmailError: string | null;
}

export const MISSING_INVITE_LINK_MESSAGE =
  'Invite created a tenant but no invite link was returned. Do not email the merchant. Repair with npm run merchant:set-password.';

export function readOperatorInviteLink(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const link = 'inviteLink' in payload ? payload.inviteLink : null;
  if (typeof link !== 'string') {
    return null;
  }

  const trimmed = link.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeCompanyName(value: string): string {
  return value.trim();
}

export function isValidMerchantInviteEmail(value: string): boolean {
  return EMAIL_PATTERN.test(normalizeEmail(value));
}

export function isValidCompanyName(value: string): boolean {
  const companyName = normalizeCompanyName(value);
  return companyName.length >= 1 && companyName.length <= 160;
}

function tenantApiKeyHash(userId: string): string {
  return userId.replaceAll('-', '');
}

export async function provisionContractedMerchant(
  input: ProvisionMerchantInput,
): Promise<ProvisionMerchantResult> {
  const email = normalizeEmail(input.email);
  const companyName = normalizeCompanyName(input.companyName);

  if (!isValidMerchantInviteEmail(email)) {
    throw new Error('A valid work email is required.');
  }

  if (!isValidCompanyName(companyName)) {
    throw new Error('Company name must be between 1 and 160 characters.');
  }

  const appProblem = input.shopifyApp ? clientShopifyAppProblem(input.shopifyApp) : null;
  if (appProblem) {
    throw new Error(appProblem);
  }

  const service = createServiceClient();
  if (input.shopifyApp) {
    const { data: claimed } = await service
      .from('tenant_integrations')
      .select('tenant_id')
      .eq('provider', 'shopify')
      .eq('shopify_shop_domain', input.shopifyApp.shopDomain.trim().toLowerCase())
      .limit(1);
    if (claimed && claimed.length > 0) {
      throw new Error(`${input.shopifyApp.shopDomain} is already connected to another Ashrium account.`);
    }
  }

  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    email_confirm: false,
    app_metadata: { invited_by: OPERATOR_INVITE_MARK },
    user_metadata: { company_name: companyName },
  });

  if (createError || !created.user) {
    const detail =
      typeof createError === 'object' && createError !== null
        ? JSON.stringify(createError)
        : String(createError ?? 'unknown');
    throw new Error(
      createError?.message && createError.message !== '{}'
        ? createError.message
        : `Unable to create the invited Auth user: ${detail}`,
    );
  }

  const userId = created.user.id;

  const { error: tenantError } = await service.from('tenants').insert({
    id: userId,
    company_name: companyName,
    owner_user_id: userId,
    status: 'active',
    api_key_hash: tenantApiKeyHash(userId),
  });

  if (tenantError) {
    await service.auth.admin.deleteUser(userId);
    throw new Error(`Unable to create tenant: ${tenantError.message}`);
  }

  const { error: merchantError } = await service.from('merchants').insert({
    id: userId,
    name: companyName,
    domain: `tenant-${userId}.internal`,
    api_key_hash: tenantApiKeyHash(userId),
  });

  if (merchantError) {
    await service.from('tenants').delete().eq('id', userId);
    await service.auth.admin.deleteUser(userId);
    throw new Error(`Unable to create merchant root: ${merchantError.message}`);
  }

  const { error: metadataError } = await service.auth.admin.updateUserById(userId, {
    app_metadata: {
      invited_by: OPERATOR_INVITE_MARK,
      tenant_id: userId,
    },
  });

  if (metadataError) {
    throw new Error(`Tenant was created but JWT tenant_id could not be stamped: ${metadataError.message}`);
  }

  if (input.shopifyApp) {
    // Registered inactive: the install + OAuth callback activate it with tokens.
    const { error: appError } = await service.from('tenant_integrations').insert({
      tenant_id: userId,
      provider: 'shopify',
      shopify_shop_domain: input.shopifyApp.shopDomain.trim().toLowerCase(),
      shopify_app_client_id: input.shopifyApp.clientId.trim().toLowerCase(),
      shopify_app_client_secret_ciphertext: encryptTenantSecret(input.shopifyApp.clientSecret.trim()),
      shopify_install_url: input.shopifyApp.installUrl.trim(),
      is_active: false,
    });

    if (appError) {
      await service.from('merchants').delete().eq('id', userId);
      await service.from('tenants').delete().eq('id', userId);
      await service.auth.admin.deleteUser(userId);
      throw new Error(`Unable to register the client's Shopify app: ${appError.message}`);
    }
  }

  const { data: linkData, error: linkError } = await service.auth.admin.generateLink({
    type: 'invite',
    email,
  });

  const hashedToken = !linkError && typeof linkData.properties?.hashed_token === 'string'
    ? linkData.properties.hashed_token
    : null;
  if (!hashedToken) {
    return {
      tenantId: userId,
      userId,
      inviteLink: null,
      inviteEmailSent: false,
      inviteEmailError: null,
    };
  }

  const inviteLink = buildAuthConfirmUrl(input.appBaseUrl, 'invite', hashedToken);
  try {
    await sendAccountEmail(email, inviteEmail(companyName, inviteLink));
    return { tenantId: userId, userId, inviteLink, inviteEmailSent: true, inviteEmailError: null };
  } catch (error) {
    return {
      tenantId: userId,
      userId,
      inviteLink,
      inviteEmailSent: false,
      inviteEmailError: error instanceof Error ? error.message : 'Invite email failed.',
    };
  }
}
