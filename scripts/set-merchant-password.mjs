import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
const password = readArg('--password');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const appBaseUrl = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

if (!email || !password) {
  console.error(
    'Usage: node scripts/set-merchant-password.mjs --email you@brand.com --password "YourPass123!"',
  );
  process.exit(1);
}

if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

if (!url || !serviceRoleKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');
  process.exit(1);
}

const service = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const normalizedEmail = email.trim().toLowerCase();
const list = await service.auth.admin.listUsers({ page: 1, perPage: 200 });
const user = list.data.users.find((entry) => entry.email?.toLowerCase() === normalizedEmail);

if (!user) {
  console.error(`No auth user found for ${normalizedEmail}. Run merchant invite first.`);
  process.exit(1);
}

const { error: updateError } = await service.auth.admin.updateUserById(user.id, {
  password,
  email_confirm: true,
});

if (updateError) {
  console.error('Unable to set password:', updateError.message);
  process.exit(1);
}

const { data: linkData, error: linkError } = await service.auth.admin.generateLink({
  type: 'recovery',
  email: normalizedEmail,
  options: { redirectTo: `${appBaseUrl}/auth/callback?next=/merchant/dashboard` },
});

console.log(
  JSON.stringify(
    {
      userId: user.id,
      email: normalizedEmail,
      passwordUpdated: true,
      recoveryLink: linkError
        ? null
        : linkData.properties?.action_link ?? null,
      signInUrl: `${appBaseUrl}/sign-in`,
    },
    null,
    2,
  ),
);

console.log('\nSign in at the sign-in URL with the email and password you just set.');
