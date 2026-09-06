import { createServiceClient } from '@/lib/supabase/service';

const OPERATOR_INVITE_MARK = 'ashrium_operator';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ProvisionMerchantInput {
  email: string;
  companyName: string;
  redirectTo: string;
}

export interface ProvisionMerchantResult {
  tenantId: string;
  userId: string;
  inviteLink: string | null;
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

  const service = createServiceClient();
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    email_confirm: false,
    app_metadata: { invited_by: OPERATOR_INVITE_MARK },
    user_metadata: { company_name: companyName },
  });

  if (createError || !created.user) {
    throw new Error(createError?.message ?? 'Unable to create the invited Auth user.');
  }

  const userId = created.user.id;

  const { error: tenantError } = await service.from('tenants').insert({
    id: userId,
    company_name: companyName,
    owner_user_id: userId,
    status: 'active',
  });

  if (tenantError) {
    await service.auth.admin.deleteUser(userId);
    throw new Error(`Unable to create tenant: ${tenantError.message}`);
  }

  const { error: merchantError } = await service.from('merchants').insert({
    id: userId,
    name: companyName,
    domain: `tenant-${userId}.internal`,
    api_key_hash: userId.replaceAll('-', ''),
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

  const { data: linkData, error: linkError } = await service.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo: input.redirectTo },
  });

  if (linkError) {
    return {
      tenantId: userId,
      userId,
      inviteLink: null,
    };
  }

  const actionLink =
    linkData.properties && typeof linkData.properties.action_link === 'string'
      ? linkData.properties.action_link
      : null;

  return {
    tenantId: userId,
    userId,
    inviteLink: actionLink,
  };
}
