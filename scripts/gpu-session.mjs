// Operator GPU control via the live app: node scripts/gpu-session.mjs [sleep|warm|status|demo [minutes]]
// Reads ASHRIUM_OPERATOR_SECRET from .env.local. Works in PowerShell and bash
// (no inline JSON for the shell to mangle). Use `sleep` after a test so the
// A100 does not stay billed.
// `demo` (live pitch): one GPU warm for 6 minutes (or [minutes], max 10); the
// server puts it back to sleep when the window ends, even if this laptop is off.
// `demo` again restarts the window; `sleep` ends it now.

process.loadEnvFile('.env.local');

/** The Shopify test store's tenant (development-store-sjkmufop). */
const DEMO_TENANT_ID = '25c0f6a4-13eb-401f-a973-0ff6d515ecd5';

const action = process.argv[2] ?? 'sleep';
if (!['sleep', 'warm', 'status', 'demo'].includes(action)) {
  console.error('Usage: node scripts/gpu-session.mjs [sleep|warm|status|demo [minutes]]');
  process.exit(1);
}
const body = action === 'demo'
  ? { action, tenant_id: DEMO_TENANT_ID, minutes: Number(process.argv[3] ?? 6) }
  : { action };

const secret = process.env.ASHRIUM_OPERATOR_SECRET?.trim();
if (!secret) {
  console.error('ASHRIUM_OPERATOR_SECRET is missing from .env.local.');
  process.exit(1);
}

// Always the live app: .env.local's APP_BASE_URL may be localhost.
const response = await fetch('https://www.ashrium.org/api/v1/hmr/keepalive', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
  body: JSON.stringify(body),
});
console.log(response.status, await response.text());
process.exit(response.ok ? 0 : 1);
