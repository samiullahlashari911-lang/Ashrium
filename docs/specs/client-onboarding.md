# Client onboarding, automatic ingest, and "Best match" — agreed plan (2026-10-09)

Settled with the owner in a grilling session. Every step ships to production
on its own (commit, push `master`, check Vercel).

## Decisions

- **Merchant account:** invite-only stays (sales-led $3,500 package). The invite
  link opens a set-password screen; sign-in gets "Forgot password". We never ask
  for a Shopify password.
- **Shopify app:** custom distribution, one app per client (off-platform
  invoicing allowed; custom apps cannot use Shopify Billing). App credentials are
  stored encrypted per tenant. Webhook HMAC and OAuth resolve the secret by shop
  domain.
- **Client setup:** one operator command,
  `npm run client:new -- <slug> <shop-domain> <email>`. It writes
  `shopify.app.<slug>.toml`, pauses once for the Dev Dashboard custom-distribution
  install link (the only step Shopify does not expose to tooling), then verifies
  every piece (client id/secret, redirect URL, scopes, theme block deployed,
  tenant, invite). Any failure stops with the exact fix and leaves nothing
  half-created; re-running is safe.
- **Webhooks:** `products/create|update|delete`, `app/uninstalled` (drop tokens),
  and the three mandatory privacy webhooks.
- **Scopes:** `read_products`, `read_metaobjects`.
- **Automatic ingest** of the whole catalog when a store connects, with no
  merchant work:
  - Claude Sonnet vision via `fetch` (no npm package; `ANTHROPIC_API_KEY`)
    reads size charts and materials from description, images, metafields,
    metaobjects, and linked size-chart pages. No headless browser.
  - Guardrails: sizes ascending, plausible ranges, unit and half-chest
    detection; one stricter retry; still failing → treated as no chart.
  - Read-only review list in the dashboard (extracted numbers beside the source).
  - Skirts gain 3D support (GarmentCode skirt templates).
  - Parse everything on Vercel; only supported categories with a complete chart
    go to the GPU, as a concurrency-limited queue with visible progress.
  - Target is Tier 1 or Tier 2 (both pass the gate). Tier 1 only when a merchant
    supplies fabric specs; we do not ask for them.
- **No "Approximate fit" wording.** The confidence AND-gate stays. Gate passes →
  solid "Your size: M" and the cart write. Gate fails → "Best match: M · based on
  your measurements", softer badge, no cart write. Styles we cannot drape show
  the avatar and size with "3D preview isn't available for this style yet."
  AGENTS.md wording updated to match (owner-approved).
- **Onboarding:** one task per screen with a progress ring, a live catalog wall
  (thumbnails turn Ready with their tier), allowlist auto-filled from the shop's
  primary domain, one link into the theme editor with the app block selected,
  and a 3D reveal of the merchant's own product.
- **Security audit twice:** first the live surface (all `/api/v1` routes,
  Supabase RLS and storage policies, embed token, GPU HMAC, OAuth state, rate
  limits) with critical/high fixes immediately; then the new surface at the end.
  Read-only checks against production only.
- **Deferred:** PostHog merchant analytics (dashboard only, inputs masked, never
  the shopper widget).

## Build order

1. Security audit, first pass
2. Set password + Forgot password
3. Per-client Shopify app (`client:new`, per-tenant secrets, webhooks)
4. Automatic ingest (Claude extraction, guardrails, skirts, GPU queue)
5. "Best match" wording + AGENTS.md
6. Onboarding redesign
7. End-to-end as a real client: fresh tenant for `aiw7ir-yv.myshopify.com`
   (~20 products with charts and images), invite to
   samiullahlashari5911@gmail.com; archive the old tenant's 150 garments
8. Avatar: real Try On against the live Modal GPU
9. Security audit, second pass

## Owner actions

- Before step 4: `ANTHROPIC_API_KEY` in `.env.local` and Vercel.
- Step 7: run `client:new`, do its one Dev Dashboard click, accept the invite.
- Shopify CLI login when the command asks.
