// Operator GPU control via the live app: node scripts/gpu-session.mjs [sleep|warm]
// Reads ASHRIUM_OPERATOR_SECRET from .env.local. Works in PowerShell and bash
// (no inline JSON for the shell to mangle). Use `sleep` after a test so the
// A100 does not stay billed.

process.loadEnvFile('.env.local');

const action = process.argv[2] ?? 'sleep';
if (!['sleep', 'warm'].includes(action)) {
  console.error('Usage: node scripts/gpu-session.mjs [sleep|warm]');
  process.exit(1);
}

const secret = process.env.ASHRIUM_OPERATOR_SECRET?.trim();
if (!secret) {
  console.error('ASHRIUM_OPERATOR_SECRET is missing from .env.local.');
  process.exit(1);
}

// Always the live app: .env.local's APP_BASE_URL may be localhost.
const response = await fetch('https://www.ashrium.org/api/v1/hmr/keepalive', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
  body: JSON.stringify({ action }),
});
console.log(response.status, await response.text());
process.exit(response.ok ? 0 : 1);
