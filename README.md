# Ashrium

Ashrium is a virtual fitting room proof of concept built with Next.js, Supabase,
Three.js, and a local FastAPI fit-check stub.

## Prerequisites

- Node.js 22 or later
- Python 3.12
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
py -3.12 -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install --requirement backend\requirements.txt
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
`REPLICATE_HMR_MODEL_VERSION`, and `REPLICATE_WEBHOOK_SIGNING_SECRET`. Obtain
the webhook secret from Replicate and configure it to call the public Vercel
route `/api/v1/webhooks/replicate`; do not use a local tunnel.

Run the two local services in separate terminals:

```powershell
npm run dev
npm run backend:dev
```

The Next.js app is served at `http://localhost:3000`; the FastAPI stub listens
only on `127.0.0.1:8000`.

## Verification

```powershell
npm run check
npm test
npm run build
```

`npm run check` preserves the combined TypeScript and ESLint check. `npm test`
imports the FastAPI application and verifies its OpenAPI metadata.

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

GitHub Actions runs TypeScript, ESLint, the production build, the FastAPI smoke
test, and a local Supabase `db reset` migration check on pull requests and
pushes to `main`. No Supabase credentials are required for that local migration
job.
