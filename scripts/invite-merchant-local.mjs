import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OPERATOR_INVITE_MARK = 'ashrium_operator';

function loadEnvFile(fileName) {
  const filePath = path.join(ROOT, fileName);
  try {
    const contents = readFileSync(filePath, 'utf8');
    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }

      const separatorIndex = line.indexOf('=');
      if (separatorIndex <= 0) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      let value = line.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // Optional local env file.
  }
}

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] ?? null;
}

loadEnvFile('.env.local');
loadEnvFile('.env');

const email = readArg('--email');
const companyName = readArg('--company');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const appBaseUrl = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

if (!email || !companyName) {
  console.error('Usage: node scripts/invite-merchant-local.mjs --email you@brand.com --company "Brand Co"');
  process.exit(1);
}

if (!url || !serviceRoleKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');
  process.exit(1);
}

const service = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: created, error: createError } = await service.auth.admin.createUser({
  email: email.trim().toLowerCase(),
  email_confirm: false,
  app_metadata: { invited_by: OPERATOR_INVITE_MARK },
  user_metadata: { company_name: companyName.trim() },
});

if (createError || !created.user) {
  const probe = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: `probe-${Date.now()}@mailinator.com`,
      email_confirm: true,
      password: 'ProbePass123!',
      app_metadata: { invited_by: OPERATOR_INVITE_MARK },
    }),
  });
  const probeBody = await probe.text();
  console.error('Auth createUser failed.');
  console.error(JSON.stringify(createError, null, 2));
  console.error('Raw Supabase response:', probe.status, probeBody);
  console.error(
    '\nRun the SQL repair in Supabase SQL Editor, then retry.',
  );
  console.error('File: supabase/migrations/20260906000000_repair_auth_user_triggers.sql');
  process.exit(1);
}

const userId = created.user.id;
const apiKeyHash = userId.replaceAll('-', '');

const { error: tenantError } = await service.from('tenants').insert({
  id: userId,
  company_name: companyName.trim(),
  owner_user_id: userId,
  status: 'active',
  api_key_hash: apiKeyHash,
});

if (tenantError) {
  await service.auth.admin.deleteUser(userId);
  console.error('Tenant insert failed:', tenantError.message);
  process.exit(1);
}

const { error: merchantError } = await service.from('merchants').insert({
  id: userId,
  name: companyName.trim(),
  domain: `tenant-${userId}.internal`,
  api_key_hash: apiKeyHash,
});

if (merchantError) {
  await service.from('tenants').delete().eq('id', userId);
  await service.auth.admin.deleteUser(userId);
  console.error('Merchant insert failed:', merchantError.message);
  process.exit(1);
}

const { error: metadataError } = await service.auth.admin.updateUserById(userId, {
  app_metadata: {
    invited_by: OPERATOR_INVITE_MARK,
    tenant_id: userId,
  },
});

if (metadataError) {
  console.error('Warning: tenant created but tenant_id metadata failed:', metadataError.message);
}

const { data: linkData, error: linkError } = await service.auth.admin.generateLink({
  type: 'invite',
  email: email.trim().toLowerCase(),
  options: { redirectTo: `${appBaseUrl}/auth/callback?next=/merchant/dashboard` },
});

if (linkError) {
  console.log(JSON.stringify({ tenantId: userId, userId, inviteLink: null }, null, 2));
  process.exit(0);
}

const inviteLink =
  linkData.properties && typeof linkData.properties.action_link === 'string'
    ? linkData.properties.action_link
    : null;

console.log(JSON.stringify({ tenantId: userId, userId, inviteLink }, null, 2));
