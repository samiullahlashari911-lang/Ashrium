# Ashrium

Ashrium is a virtual fitting room built with Next.js, Supabase, and Three.js.

## Prerequisites

- Node.js 22 or later
- Docker Desktop (only for local Supabase migration verification)
- A Supabase project, when connecting the application to a remote environment

### Windows path note

The repository's current OneDrive path contains `&`, which can break npm command
shims. Work from a path without special shell characters before running npm
commands. For example, in an elevated PowerShell session:

```powershell
New-Item -ItemType Junction -Path C:\dev\ashrium -Target "$PWD"
Set-Location C:\dev\ashrium
```

## Local setup

```powershell
npm ci
Copy-Item .env.example .env.local
```

Set the values in `.env.local` from the Supabase project's Connect dialog. The
service-role key is server-only: never expose it in browser code, logs, or a
`NEXT_PUBLIC_*` variable. `.env.local` must use standard `NAME=value` entries;
do not leave masked values or other non-`.env` characters in the file, because
the Supabase CLI parses it during local commands.

Generate `WIDGET_EMBED_SIGNING_SECRET` with at least 32 random characters.
Embed URLs are tenant-scoped and expire after 15 minutes; generate them from
authenticated server code with `createWidgetEmbedConfig`. Never construct
widget URLs from a `tenant_id` query parameter or expose the service-role key
to an embed script.

For live Replicate inference, set `REPLICATE_API_TOKEN`,
`REPLICATE_HMR_MODEL_VERSION`, `REPLICATE_DEPLOYMENT`, and
`REPLICATE_WEBHOOK_SIGNING_SECRET` in `.env.local`. Do not paste the token
into chat or commit it. Obtain the webhook secret from Replicate and
configure it to call the public Vercel route `/api/v1/webhooks/replicate`;
do not use a local tunnel.

`REPLICATE_HMR_MODEL_VERSION` must be a live Cog version: a 64-character
hash, or `owner/name:<hash>`. `REPLICATE_DEPLOYMENT=owner/name` is
required. Shopper inference talks to that Deployment. Merchants cannot
Warm/Sleep it. There is no default hash, no mock model, and no dummy
keep-alive prediction.

### Push the A100 Cog and create a Deployment

The live GPU is the tree in `cog/` (SAM 2 silhouettes → SAM 3D Body
initializer → two-view MHR `task=body`) on `gpu-a100-large`. HuggingFace
access to **SAM 3D Body** is required — set `HF_TOKEN` as a Replicate
secret after the gated repo accepts you. Do not stub the initializer.

```powershell
# From a machine with the Cog CLI and a Replicate token
cog login
Set-Location cog
cog push r8.im/<owner>/ashrium-vfr
```

Then in the Replicate dashboard: create a **Deployment** of that model on
Nvidia A100 80GB (`gpu-a100-large`), leave `min_instances=0` until a test
session, and put the version hash plus `owner/name` into `.env.local`.

`POST /api/v1/hmr` warms the Deployment (`min_instances=1`) when a shopper
submits both verified photos. The GPU sleeps (`min_instances=0`) when no
fit job is still pending or processing. Merchants cannot scale the GPU.
Manual Warm/Sleep is operator-only (`ASHRIUM_OPERATOR_SECRET` or
`CRON_SECRET` on `POST /api/v1/hmr/keepalive`). GET on that route only
reads status. `$5 ≈ 3,571s` of billed A100 including idle
(`$0.001400/s`). Do not leave `min_instances=1` overnight.

TTL sweep cron (`GET /api/v1/cron/ttl-sweep` with `CRON_SECRET`) stays
separate. Immediate photo wipe on inference success or failure is still
the hot path.

`POST /api/v1/hmr` dispatches `task=body` to the Deployment and returns
`202` right away, completion arrives via `/api/v1/webhooks/replicate`,
and the widget waits on the `fit_job:{id}` Realtime topic with a 2-second
status poll as backup. Photos are still wiped as soon as inference
finishes or fails. A real body predict returns MHR params or the **real**
Replicate error — there is no fixture phenotype.

Hobby can schedule a single daily cron. Prefer `/api/v1/cron/ttl-sweep`
in that slot (`0 4 * * *`). The migration also tries to schedule
`pg_cron` every five minutes for the SQL-only half of the sweep when that
extension is available.

Ping the TTL sweep locally with:

```powershell
curl -H "Authorization: Bearer $env:CRON_SECRET" http://localhost:3000/api/v1/cron/ttl-sweep
```

Start the Next.js app:

```powershell
npm run dev
```

The app is served at `http://localhost:3000`. `/` is the public marketing
landing page; the merchant portal starts at `/sign-in`. After sign-in the live
merchant home is `/merchant/dashboard`, except that a merchant with an empty
`tenants.allowed_domains` is sent to `/onboarding` first.

## Merchant onboarding

`/onboarding` is a four-step setup wizard: confirm the company name, allowlist
the storefront origins, connect Shopify and install the theme app block, and
add the first garment. Every step writes through the same routes and server
actions the settings pages use, so the wizard can be revisited at any time from
the Setup nav item.

On Garments, **Test one SKU** is the primary ingest path: paste a product URL,
product ID, variant ID, or SKU. Full catalog sync remains available as a
secondary action. Shopify Admin credentials live in Settings → Integrations
(shop domain + Admin token), not in `.env`.

The storefront allowlist is edited on `/settings` (and in step 2 of the wizard).
It writes `tenants.allowed_domains`, which is the origin allowlist that
`POST /api/v1/widget/token` and the widget embed page check. Until at least one
origin is stored, the storefront widget cannot mint an embed token.

## Invite-only merchant portal

The merchant dashboard is contract-only. There is no public Create account
flow. Shoppers on the storefront widget do not need an Ashrium login; they
use a short-lived embed token. `tenants.allowed_domains` remains the
storefront origin allowlist and is separate from portal access.

Disable public email sign-ups in the hosted Supabase project:
Authentication → Providers → Email → turn off “Allow new users to sign up”.
The database still rejects Auth inserts that are not stamped
`app_metadata.invited_by = ashrium_operator`, even if that dashboard toggle
is left on.

Invite a contracted merchant (app must be running, with
`ASHRIUM_OPERATOR_SECRET` and `APP_BASE_URL` set):

```powershell
npm run merchant:invite -- --email merchant@brand.com --company "Brand Co"
```

That calls `POST /api/v1/operator/invite-merchant` with a bearer operator
secret (service role on the server). It creates the Auth user, `tenants` +
`merchants` rows, stamps `app_metadata.tenant_id`, and returns an invite
link when Supabase can issue one. New tenants are `status = active`.
A signed-in user whose tenant is missing or suspended is sent back to
`/sign-in` with an error.

## Verification

```powershell
npm run check
npm run build
```

`npm run check` runs TypeScript, ESLint, and `npm run test` (Node's built-in
test runner: pose gates, the confidence AND-gate, request parsers, and route
guards). No new test-framework package is added.

### Storefront twins

Shopify: `extensions/shopify-vfr/blocks/vfr_embed.liquid`.
WooCommerce: `extensions/woocommerce-vfr/ashrium-vfr.php` (WordPress plugin;
set the Ashrium platform URL under Settings → Ashrium VFR, allowlist the shop
origin, and the block maps `VFR_SIZE_RECOMMENDED` onto the matching variation).

Shopper consent copy lives at `/privacy` and as a required checkbox on capture
intake. Stripe is not part of v1.

### Supabase migrations

The checked-in migration is verified against a disposable local Supabase stack:

```powershell
npm run supabase:start
npm run supabase:verify
npm run supabase:stop
```

This requires Docker Desktop to be running and downloads Supabase container
images on first use. `supabase:verify` runs `db reset --local`, which recreates
the local database and applies every migration under `supabase/migrations/`.
It does not contact or alter a remote Supabase project.

To inspect a remote project's pending migration changes, authenticate and link
the CLI explicitly:

```powershell
npx --yes supabase@2.110.0 login
npx --yes supabase@2.110.0 link --project-ref <project-ref>
npx --yes supabase@2.110.0 db push --dry-run
```

Apply remote migrations only after a reviewed backup and deployment approval:

```powershell
npx --yes supabase@2.110.0 db push
```

## CI

GitHub Actions runs TypeScript, ESLint, unit tests, the production build, and a
local Supabase `db reset` migration check on pull requests and pushes to `main`.
No Supabase credentials are required for that local migration job.
