import { readFileSync } from 'node:fs';
import path from 'node:path';
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
const baseUrl = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const secret = process.env.ASHRIUM_OPERATOR_SECRET;

if (!email || !companyName) {
  console.error('Usage: node scripts/invite-merchant.mjs --email merchant@brand.com --company "Brand Co"');
  process.exit(1);
}

if (!secret || secret.length < 16) {
  console.error('ASHRIUM_OPERATOR_SECRET must be set (at least 16 characters).');
  process.exit(1);
}

const response = await fetch(`${baseUrl}/api/v1/operator/invite-merchant`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${secret}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ email, companyName }),
});

const body = await response.text();
if (!response.ok) {
  console.error(`Invite failed (${response.status}): ${body}`);
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(body);
} catch {
  console.error('Invite returned a non-JSON body. Do not email the merchant.');
  console.error(body);
  process.exit(1);
}

const inviteLink = typeof payload?.inviteLink === 'string' ? payload.inviteLink.trim() : '';
if (!/^https?:\/\//i.test(inviteLink)) {
  console.error(
    'Invite created a tenant but no invite link was returned. Do not email the merchant. Repair with npm run merchant:set-password.',
  );
  console.error(body);
  process.exit(1);
}

console.log(body);
