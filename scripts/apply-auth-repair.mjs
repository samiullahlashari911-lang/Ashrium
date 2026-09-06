import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

loadEnvFile('.env.local');
loadEnvFile('.env');

const projectRef =
  process.env.SUPABASE_PROJECT_REF
  ?? process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

const dbPassword = process.env.SUPABASE_DB_PASSWORD?.trim();

if (!projectRef) {
  console.error('Could not resolve Supabase project ref. Set SUPABASE_PROJECT_REF or NEXT_PUBLIC_SUPABASE_URL.');
  process.exit(1);
}

if (!dbPassword) {
  console.error(
    'Missing SUPABASE_DB_PASSWORD in .env.local.\n'
      + 'Supabase Dashboard → Project Settings → Database → Database password.\n'
      + 'Then rerun: node scripts/apply-auth-repair.mjs',
  );
  process.exit(1);
}

const repairFile = path.join(ROOT, 'supabase/migrations/20260906000000_repair_auth_user_triggers.sql');
const dbUrl =
  process.env.SUPABASE_DB_URL?.trim()
  ?? `postgresql://postgres.${projectRef}:${encodeURIComponent(dbPassword)}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;

console.log(`Applying auth trigger repair to project ${projectRef}...`);

const push = spawnSync(
  process.execPath,
  [
    path.join(ROOT, 'node_modules', 'npx', 'cli.js'),
    '--yes',
    'supabase@2.110.0',
    'db',
    'push',
    '--db-url',
    dbUrl,
    '--yes',
  ],
  {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  },
);

if (push.status !== 0) {
  console.error('\nIf db push failed, paste this file in Supabase SQL Editor instead:');
  console.error(repairFile);
  process.exit(push.status ?? 1);
}

console.log('Auth trigger repair applied. Retrying merchant invite is safe now.');
