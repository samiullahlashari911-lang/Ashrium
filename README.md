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

For live Modal inference, set `MODAL_GPU_URL` and `ASHRIUM_GPU_HMAC` in
`.env.local`. Do not paste secrets into chat or commit them. There is no
Replicate webhook.

### Deploy the A100 GPU app on Modal

The live GPU is the tree in `gpu/` (SAM 2 silhouettes → SAM 3D Body
initializer → two-view MHR `task=body`) on Modal `A100-80GB`. HuggingFace
access to **SAM 3D Body** is required — set `HF_TOKEN` as a Modal secret
after the gated repo accepts you. Do not stub the initializer.

```powershell
pip install modal
modal token new
modal secret create HF_TOKEN HF_TOKEN=hf_...
modal secret create ASHRIUM_GPU_HMAC ASHRIUM_GPU_HMAC=...
modal deploy gpu/modal_app.py
modal run gpu/modal_app.py::prefetch_weights
```

Put the HTTPS web endpoint into `MODAL_GPU_URL`. Shopper consent warms
`min_containers=1`. The GPU sleeps (`min_containers=0`) when no fit job is
still pending or processing. Merchants cannot scale the GPU. Manual
Warm/Sleep is operator-only (`ASHRIUM_OPERATOR_SECRET` or `CRON_SECRET` on
`POST /api/v1/hmr/keepalive`). GET on that route only reads status.
Idle A100 is `$0.000694/s`. Do not leave `min_containers=1` overnight.

TTL sweep cron (`GET /api/v1/cron/ttl-sweep` with `CRON_SECRET`) stays
separate. Immediate photo wipe on inference success or failure is still
the hot path.

`POST /api/v1/hmr` returns `202` and runs Modal `task=body` on the request
path. The widget waits on the `fit_job:{id}` Realtime topic with a status
poll as backup. Photos are still wiped as soon as inference finishes or
fails. A real body predict returns MHR params or the **real** Modal error
— there is no fixture phenotype.

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
