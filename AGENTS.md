# AGENTS.md — Ashrium Virtual Fitting Room (VFR)

Read this file in full before touching any code. It is the source of truth for
every prompt, every feature slice, and every review. If a request conflicts
with this file, stop and ask before proceeding.

---

## 1. Role

You are a senior full-stack engineer working across **Next.js App Router,
Supabase (Postgres + Storage + Realtime), Three.js WebGL rendering, and
Shopify Liquid**. You write production-grade TypeScript, respect existing
architecture, and never rewrite working code to satisfy a single feature
request. You think like an engineer maintaining a live commercial product,
not like someone prototyping a demo.

Python is allowed **only inside the Replicate Cog** (`cog/`). The Next.js app
stays TypeScript and talks to Replicate with `fetch`. Do not add a local
Python API (`backend/main.py` is retired and must not become the inference
path).

---

## 2. Project Overview

Ashrium VFR is a **multi-tenant virtual fitting room** embedded in Shopify
storefronts (WooCommerce later). A shopper attests age, consents, enters
height, sex, and optional weight, takes two guided photos (front A-pose, side
profile with wrists at or above the shoulders), and the client **crops the
head on-device** before uploading two headless WebPs. The shopper receives a
3D avatar built on the **Meta MHR** parametric body (topology
`mhr-18439-127`). Garments are ingested server-side from the merchant's
catalog via **GarmentCode/PyGarment core (MIT)** — never
`NvidiaWarp-GarmentCode` — graded by re-instantiating the 2D pattern per
size, and draped with **Newton XPBD on the same warm Replicate A100
deployment**. When the confidence AND-gate passes, the shopper gets a
specific size recommendation written into the cart; otherwise they see an
approximate fit with no hard size claim.

The repository today is a **working multi-tenant shell**: auth, garment CRUD,
invite-only merchant provision, onboarding, Shopify settings, a live Replicate
dispatch/poll/webhook path, Three.js viewports (including a clearance heatmap
and sim-delta v2), a Shopify Liquid block, and telemetry ingestion. The
locked product in this file **supersedes ANNY-Fit, `anny-13380-104`, and
in-process JS XPBD on the shopper path**. Those pieces are extended or
retired per the roadmap in Section 11. Do not write new ANNY phenotypes,
stamp `anny-13380-104` on new rows, or treat ANNY-Fit as the live GPU.

**Live GPU = our Cog on Replicate A100** (`gpu-a100-large`), reached through
a Replicate **Deployment**. Required env (fail closed — no mock fallback):
`REPLICATE_API_TOKEN`, `REPLICATE_HMR_MODEL_VERSION` (pushed Cog version
hash), and `REPLICATE_DEPLOYMENT` (`owner/name`). If any of these is missing,
stop and ask. If HuggingFace gated access to **SAM 3D Body** weights is not
granted, stop — do not stub the initializer.

**This build is fully functional, not a mock or a demo.** Every slice must
call the real Cog, run real MHR fit / Newton drape / GarmentCode ingest, and
write real data through the real Supabase project. Do not build mock
inference, mock CAD grading, stub responses, hardcoded fixture phenotypes, or
placeholder "pretend this worked" branches anywhere in the app.

**Core commercial product:** $3,500 managed package per merchant, usage
meters, and a return-rate guarantee dashboard. No Stripe in v1 (isolated to
Phase 7 or later). Shopify first; WooCommerce is a later twin of the Liquid
block.

---

## 3. Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router) |
| Language | TypeScript, strict mode (app). Python **only** in `cog/`. |
| Database / Auth / Storage | Supabase (Postgres, Storage buckets, Realtime, tenant JWT) |
| 3D Rendering | Three.js (raw, WebGL) |
| Body model | **Meta MHR** (Apache 2.0 code + assets). LOD 1 render topology `mhr-18439-127`. LOD 3 (~4,899 verts) as cloth collider. |
| Body inference Cog | SAM 2 silhouettes (Apache 2.0) → **SAM 3D Body as initializer only** (SAM License on that step) → joint two-view **MHR** fit |
| Cloth simulation | **Newton XPBD** (`SolverXPBD` / `SolverVBD` on upstream Warp, Apache 2.0) **inside the same warm Cog deployment** (`task=drape`). JS XPBD in `lib/graphics/xpbd-cloth.ts` is debug-only. |
| Pattern ingest | **GarmentCode / PyGarment core (MIT)** inside the Cog (`task=pattern`). Never `NvidiaWarp-GarmentCode`. |
| Pose capture | MediaPipe Pose (`@mediapipe/tasks-vision`) — already in the stack |
| ML / GPU | Replicate **Deployment** on `gpu-a100-large`, via `fetch` in `lib/ml/replicate.ts`. Not ANNY-Fit. |
| Storefront Integration | Shopify Liquid block + `public/vfr-widget.js` iframe |
| Styling | Design tokens in `lib/design-tokens.ts` ("Obsidian") |

**Do not** introduce any other major library without approval. See Section 10.

---

## 4. Development Philosophy

- Build **one vertical slice at a time**. Each phase in the roadmap (Section
  11) is a demoable, isolated slice with its own contract (types + API
  routes). Later phases *consume* earlier contracts — they do not rewrite
  earlier UI or types.
- **Build against the live Cog on Replicate A100 and real CAD grading — no
  mocks.** Every slice must run end-to-end with `REPLICATE_API_TOKEN`,
  `REPLICATE_HMR_MODEL_VERSION`, and `REPLICATE_DEPLOYMENT`. The Cog version
  is swappable via the version env so the widget, capture flow, and viewport
  do not need a rewrite — "swappable" does not mean "mocked."
- Prefer the smallest working version of a feature. Do not add
  configurability, abstraction layers, or edge-case handling that wasn't
  asked for.
- Do not touch code outside the current phase's file map (Section 5.5)
  unless the task explicitly requires it.
- Refactor only when a pattern is clearly repeated three or more times, and
  only inside the current slice.
- When in doubt about scope, ask. Do not guess and ship a bigger diff than
  requested.

---

## 5. Architecture

### 5.1 What already exists — extend, do not rebuild

- **Auth / access:** `app/(auth)/sign-in/page.tsx`,
  `app/(auth)/auth/callback/route.ts`, tenant JWT in `lib/supabase/tenant.ts`,
  invite-only provision (`scripts/invite-merchant.mjs`,
  `lib/server/provision-merchant.ts`)
- **APIs:** dual signed WebP upload, Replicate dispatch/poll/webhook, widget
  token/script, telemetry, garments CRUD, usage meters, catalog sync,
  fit recommend/resolve
- **Widget isolation:** `public/vfr-widget.js`, `lib/widget/bridge.ts`,
  `components/widget/StorefrontViewport.tsx`
- **Viewport / graphics:** clearance heatmap + sim-delta v2
  (`lib/graphics/radial-heatmap.ts`, `lib/graphics/strain-shader.ts`),
  disposal in `components/vfr/vfr-canvas.tsx`
- **Capture gates:** honest pose gates in
  `components/widget/guided-capture/capture-viewport.tsx`
- **Merchant UI:** onboarding wizard, Shopify settings form, per-SKU ingest
  (`components/dashboard/catalog-sync-bar.tsx`,
  `lib/catalog/shopify-selector.ts`), operator GPU banner
  (`components/dashboard/replicate-runtime-banner.tsx`)
- **Biometrics wipe:** `lib/server/biometrics-wipe.ts`
- **Design tokens:** `lib/design-tokens.ts` (Obsidian — indigo canvas, glass
  panels, purple→magenta CTAs); do not introduce a new UI kit unless asked.

Session GPU warm uses Deployment PATCH `min_instances=1`; Sleep and the
sandbox 45-minute safety timeout set `min_instances=0`. Do not add 24/7
Vercel cron keep-alive against the trial A100 credit.

To retire (do not build new work against these):

- ANNY-Fit output parse, `AnnyParametricVector` on **new** rows, and
  `public/models/anny-hull.glb` as the product hull (Phase 3)
- In-process JS XPBD as the shopper drape path (Phase 4; keep as debug)
- Invented catalog girths (`completeMeasurements` filling chest/waist/hip
  and marking them as source-true) (Phase 5)
- Local `backend/main.py` as an API
- Static demo `app/merchant/page.tsx` if it reappears — live dashboard is
  the post-login home

### 5.2 Widget isolation model

The storefront-facing widget is a sandboxed iframe. It must never contain
merchant credentials, Shopify Admin tokens, or raw garment CAD data. It
receives only:
- an **embed token** (not the merchant JWT), used solely to mint upload URLs
  and dispatch HMR/meter calls
- `product_id` / `variant_id` / `sku` from the host page via
  `lib/widget/bridge.ts`

All catalog ingestion, KES/grading, GarmentCode, and Shopify Admin GraphQL
calls happen **server-side only** (Section 8). The widget never talks to
Shopify Admin directly.

### 5.3 API routes

- All product API routes live under **`/api/v1/*`**. Do not create routes
  outside this namespace.
- Every `fit_jobs` row and every API call that touches a fit job must carry
  `tenant_id`. Never drop tenant scoping to "make it work."
- Realtime subscriptions use the private topic pattern `fit_job:{id}` only.
  Never use wildcard topics like `fitting_session:%`.

### 5.4 Database schema conventions

- Do not rename `fit_jobs`. Extend it: `height_cm`, `sex`, `weight_kg`
  (nullable), `front_image_path`, `side_image_path`,
  `parametric_result jsonb`, `inference_duration_ms`. Stop writing to
  `gltf_output_url` as the product output — that field is legacy. Stamp
  `topology_version` inside `parametric_result`. New rows use
  **`mhr-18439-127`**. Do not write `anny-13380-104` on new rows.
- `garment_cad_profiles`: `category`, `composition` (JSON), `GSM`, ingest
  `confidence`, `mode` (A/B/C), and an approximate-fit flag. Keep the
  existing mechanical columns (`k_stretch`, etc.) as the KES-mapped target
  for **drape look only** — KES must not flip the size verdict. Mode A is
  explicit KES/mechanical (Tier 1). Mode B is pipeline-validated Tier 2: a
  product-page size chart plus material, mapped through the KES table — no
  merchant click. Mode C is category defaults and stays approximate.
  Unsupported geometry (hoods, lapels, cargo, knits) is an explicit
  dashboard state: storefront Approximate / no 3D.
- `garment_size_variants`: `size_code`, chest/waist/hip/length cm,
  rest-length / pattern storage path. Grade by **re-instantiating the 2D
  pattern per size**, not radial 3D scale.
- `simulation_cache` (vector-enabled): `variant_id`, `vector(6)`, storage
  paths, clearance stats. Cache hit is a latency optimization only.
- Biometrics bucket: `image/webp` only, 15-minute TTL, path pattern
  `{tenant}/{job}/front.webp` and `{tenant}/{job}/side.webp`. Uploaded
  frames are **head-cropped**; no face pixels on the server.
- A TTL sweep must exist for both the image bucket and any row holding a
  raw phenotype. `GET /api/v1/cron/ttl-sweep` (Bearer `CRON_SECRET`) plus
  SQL helpers (`sweep_privacy_ttl_db`, optional pg_cron) remain the sweep
  path. Immediate wipe on inference success or failure remains the hot
  path. Do **not** reuse that cron to keep the A100 warm.

### 5.5 File map (primary, by area)

| Area | Files |
|---|---|
| Types | `types/hmr.ts` (`MhrParametricVector`; stop writing new ANNY rows), `types/graphics.ts`, `types/garment.ts`, `types/database.ts` |
| Capture / widget | `components/widget/guided-capture/*`, `StorefrontViewport.tsx`, `lib/widget/bridge.ts`, `lib/widget/fit-client.ts`, `lib/widget/webp-encode.ts` (head crop), `lib/widget/pose-gates.ts`, `extensions/shopify-vfr/blocks/vfr_embed.liquid` |
| Size / confidence | `lib/fit/size-recommend.ts`, `lib/fit/confidence-gate.ts`, `lib/fit/recommend.ts`, `lib/fit/simulation-match.ts`, `app/api/v1/fit/recommend/route.ts`, `components/vfr/confidence-badge.tsx` |
| Avatar / drape (app) | `components/vfr/anny-canvas.tsx` / `lib/graphics/anny-hull.ts` (consume MHR until renamed), `lib/graphics/anny-hull-server.ts`, `lib/graphics/anny-garment.ts`, `lib/graphics/meshopt-delta.ts`, `lib/graphics/strain-shader.ts` (clearance), `lib/graphics/radial-heatmap.ts`, `lib/graphics/dispose-session.ts`, `components/vfr/radial-heatmap-legend.tsx`, `public/models/mhr-hull.glb` (`mhr-18439-127`). Debug only: `lib/graphics/xpbd-cloth.ts`, `components/vfr/vfr-canvas.tsx`, `lib/graphics/pbd-cloth.ts`. Retire `public/models/anny-hull.glb` from the hot path. |
| Cog (Python) | `cog/predict.py`, `cog/cog.yaml`, `cog/requirements.txt`, `cog/body/*` (SAM 2 silhouettes, SAM 3D Body initializer, two-view MHR fit, ISO girths). Tasks: `body` (this phase), `drape` / `pattern` fail closed until later phases. |
| API | `app/api/v1/biometrics/upload-url/route.ts`, `app/api/v1/hmr/route.ts`, `app/api/v1/hmr/status/route.ts`, `app/api/v1/hmr/keepalive/route.ts` (session `min_instances`, not dummy predict), `app/api/v1/cron/ttl-sweep/route.ts`, `app/api/v1/webhooks/replicate/route.ts`, `lib/server/request-tenant.ts`, `lib/server/cron-secret.ts`, `lib/server/durable-rate-limit.ts`, `lib/server/ttl-sweep.ts`, `lib/supabase/fit-job-realtime.ts`, `app/api/v1/catalog/sync/route.ts`, `lib/catalog/*`, `lib/server/shopify-credentials.ts`, `lib/server/shopify-actions.ts`, `app/api/v1/fit/recommend/route.ts`, `app/api/v1/fit/resolve/route.ts`, `lib/fit/resolve-drape.ts` (shopper path → Cog `task=drape`), `app/api/v1/operator/invite-merchant/route.ts` |
| ML | `lib/ml/replicate.ts` (Deployment fetch; parse MHR output; PATCH `min_instances`) |
| Merchant UI | `app/page.tsx`, `app/privacy/page.tsx`, `lib/privacy/consent-copy.ts`, `lib/privacy/illinois-bipa.ts` (BIPA geofence ship flag; off until counsel), `app/(dashboard)/dashboard-navigation.tsx`, `app/(dashboard)/onboarding/page.tsx`, `app/(dashboard)/onboarding/onboarding-wizard.tsx`, `app/(dashboard)/settings/page.tsx`, `app/(dashboard)/settings/integrations/shopify-form.tsx`, `components/settings/domain-allowlist-form.tsx`, `components/settings/telemetry-secret-form.tsx`, `components/dashboard/empty-state.tsx`, `components/dashboard/catalog-sync-bar.tsx`, `components/dashboard/replicate-runtime-banner.tsx`, `lib/onboarding.ts`, `lib/server/tenant-settings.ts` |
| Theme | `lib/design-tokens.ts`, `components/theme/atmosphere-backdrop.tsx` |
| Auth / access | `app/(auth)/sign-in/auth-form.tsx`, `lib/supabase/merchant-access.ts`, `lib/server/provision-merchant.ts`, `lib/server/operator-secret.ts`, `scripts/invite-merchant.mjs` |
| Storefront twins | `extensions/shopify-vfr/blocks/vfr_embed.liquid`, `extensions/woocommerce-vfr/ashrium-vfr.php` |
| Tests | `tests/*.test.ts` (head crop / no-face bbox, side wrist gate, confidence gate, route parsers, cron auth) |
| DB | migrations for `fit_jobs` columns, WebP paths, size variants, vector cache, `match_simulation_cache` RPC, `garment-simulations` bucket, Realtime trigger, invite-only merchant access (`tenants.status`), Shopify catalog credentials + `garment-cad` rest-length bucket, durable `rate_limit_hits` + TTL sweep RPCs |

---

## 6. UI / Styling Rules

Aesthetic reference: **3DLOOK-style clean, minimal capture flows** (as seen
in YourFit / Mobile Tailor) — generous whitespace, a single clear call to
action per screen, visible progress state, and a calm, trustworthy tone. Key
patterns to replicate, not copy pixel-for-pixel:

- **Consent and age before camera.** The intake screen names what is
  collected, why, the 15-minute destruction window, and that the head is
  cropped on-device. Age attestation is required before Continue; refuse
  the under-16 / COPPA path. Fitted-clothing copy: the silhouette must not
  become the body (shopper should wear fitted clothes, not bulky outerwear).
- **Guided capture viewport:** live camera feed with an overlay silhouette,
  a real-time gate indicator (aligned / too close / turn required), and
  auto-capture on a **1.2s hold** after gates pass — not a manual shutter
  as the primary path. **Side gate:** wrists at or above the shoulders.
  **Head crop** from MediaPipe landmarks runs in `encodeVideoFrameToWebp`
  so face pixels never leave the device.
- **Illinois BIPA geofence (ship flag).** Optional until counsel signs off.
  A timezone/locale heuristic is **not legal advice**. Document the flag in
  code and leave it off unless a later task turns it on.
- **Confidence badges:** a small, unambiguous visual state — e.g. a solid
  badge for high-confidence size claims, an outlined/muted badge with
  "Approximate fit" copy when the confidence AND-gate fails. Never render an
  approximate result to look identical to a confident one.
- **3D drape viewport:** faceless, **non-skin-toned** mannequin (do not
  infer skin; GDPR Art. 9) with a neutral undergarment layer. Avatar and
  garment centered with generous negative space; rotate/zoom only in v1.
  **Clearance heatmap** (loose = blue) is a **toggle**, not always-on over
  the product texture. Legend sits at the edge, not overlapping the model.
  Strain is not a verdict.
- **GPU session chrome (sandbox):** shopper/sandbox path uses a Replicate
  Deployment. **Warm A100 for this session** sets `min_instances=1` (idle
  billed, no cold start). **Sleep A100** and a **45-minute safety timeout**
  set `min_instances=0`. Do **not** run 24/7 Vercel cron keep-alive. The
  trial credit is ~$5 ≈ 3,571s of billed A100 including idle
  (`$0.001400/s`). One warm test hour **is** the credit. Do not leave
  `min_instances=1` overnight. Ingest (`task=pattern`) may cold-start; do
  not hold `min_instances` for catalog.
- Use the existing **Obsidian design tokens** (`lib/design-tokens.ts`) for
  the widget, dashboard, and auth chrome: deep indigo canvas, glass panels,
  and purple-to-magenta CTAs. Do not add a component/UI kit unless
  explicitly approved.
- Replicate any attached design exactly: spacing, type hierarchy, corner
  radius, and color. Do not "simplify" or approximate a provided design.
- Empty states are required everywhere data can be absent (no garments yet,
  no telemetry yet, no size result yet) — never leave a blank panel.

---

## 7. Body Model & Simulation Rules

This is the most failure-prone area of the codebase. Follow these exactly.

- **Single source of truth for topology:** ship `public/models/mhr-hull.glb`
  (Meta MHR Apache 2.0 assets). Stamp `topology_version` on every phenotype,
  every cached delta, and every placeholder asset. Official render topology
  is **MHR LOD 1: 18,439 vertices / 127 joints**, version string
  **`mhr-18439-127`**. Cloth collider is **MHR LOD 3 (~4,899 verts)**. Do
  not write `anny-13380-104` (or the historical 13,718/163 ANNY figures) on
  new phenotypes or cache rows.
- **MHR parametric body only.** New product representation is
  `MhrParametricVector`: shape / skeleton / pose params, `joint_rotations`
  as needed, `derived_measurements` (chest/waist/hip cm via ISO 8559-1 plane
  slice + 2D convex hull), `topology_version`, optional `stated_weight_kg`,
  and vertex buffer or storage URL for the deformed LOD 1 mesh. Prefer
  **server-authored vertex positions** when the Cog returns them (avoids
  client/server deform drift). `AnnyParametricVector` is legacy; do not
  write it on new `fit_jobs` rows. SMPL-X mesh types stay retired.
- **Cog `task=body` (live weights, no fixtures).** Inputs: `front_image`,
  `side_image`, `height_cm`, `sex`, optional `weight_kg`. Pipeline:
  1. SAM 2 silhouettes (Apache 2.0)
  2. SAM 3D Body per view as **initializer only**
  3. Joint differentiable MHR fit: shared identity (20 body) + shared
     skeleton (68), per-view pose; hard constraint skeleton height = stated
     height; keypoints primary, silhouette **weak** (clothed outline must
     not inflate girths)
  4. Re-evaluate MHR in **canonical pose** (do not measure a reposed LBS
     mesh)
  5. Girths: plane slice + 2D convex hull (ISO 8559-1). Horizontal torso;
     limb-axis for limbs; body-part filter so an A-pose chest slice does
     not span both arms
- **No box mesh, no dummy geometry, no stubbed inference.**
  `lib/ml/replicate.ts` calls the live Deployment. Fail closed if token,
  version, or `REPLICATE_DEPLOYMENT` is missing. Surface the real Replicate
  error — never fabricate a phenotype. Client code must never assume a
  fixed morph-target count.
- **Drape resolution order (`task=drape` on the same warm GPU):** attempt
  `simulation_cache` match first (cosine similarity, threshold ≥ 0.995,
  scoped by `variant_id` + `tenant_id`) as a **latency optimization**. On a
  miss, run Newton XPBD/VBD in the Cog on the rigid MHR LOD 3 collider
  (~4–6k garment verts). Stop when displacement + regional **clearance**
  stabilize. Write clearance into sim-delta v2, store the meshopt delta in
  `garment-simulations`, insert the vector into `simulation_cache`.
  `lib/fit/resolve-drape.ts` calls Replicate on the shopper path — not
  `lib/graphics/xpbd-cloth.ts`. A miss must **not** withhold size; size is
  girth + chart. Drape may land late on `fit_job:{id}` Realtime. **Drape
  must never block the avatar SLA** (`task=body` stays the avatar path).
- **Client 8s drape deadline:** if drape has not landed, still show the
  girth-based size with an **Approximate** badge. Do not write a hard size
  into the cart.
- **Client-side compositing:** `V_final = V_0 + ΔX`. Heatmap is
  **clearance** (loose regions = blue). Strain may exist as a debug channel;
  it is not a size verdict. Keep `lib/graphics/pbd-cloth.ts` /
  `xpbd-cloth.ts` as optional debug — not the storefront rendering path.
- **Confidence gate (hard rule):** a high-confidence size claim (solid
  badge + `VFR_SIZE_RECOMMENDED` cart write) requires **ALL** of:
  1. capture gates passed (including side wrists-at-shoulders and successful
     on-device head crop)
  2. garment ingest confidence is Tier 1 or pipeline-validated Tier 2
  3. clothing / height residual is within tolerance
  4. drape has landed (cache hit **or** completed Newton run) within the 8s
     client deadline
  If any condition fails, render "Approximate fit" — never emit a hard size
  claim without the full AND-gate. The **size number** is always from
  girths + the published size chart. KES and clearance must not flip that
  number.
- **Three.js memory discipline:** every renderer, geometry, material, and
  texture created for a session must be disposed when that session ends or
  the component unmounts. Follow the existing disposal pattern in
  `components/vfr/vfr-canvas.tsx`. Every phase must dispose what it creates.

---

## 8. Biometrics & Security Rules

- **No React Three Fiber.** No `replicate` npm package — all Replicate calls
  go through `fetch` in `lib/ml/replicate.ts`. These are hard bans, not
  preferences.
- **Consent, age, then camera.** No live camera until the shopper checks
  consent (copy in `lib/privacy/consent-copy.ts`) and attests they are 16+.
  Refuse the under-16 / COPPA path. `/privacy` must match the checkbox.
- **Head crop before WebP.** Guided capture produces exactly two images —
  front and side — with the head removed from MediaPipe landmarks, then
  encoded client-side to WebP (1024px, q85). **No face pixels on the
  server.** Uploads use short-lived signed PUT URLs minted via the embed
  token, never a merchant credential.
- **Ephemeral storage, always.** Biometric images live in a bucket with a
  15-minute TTL and are wiped immediately on inference success *or* failure
  via `lib/server/biometrics-wipe.ts`. No raw photo is ever stored beyond
  that window, and no code path should treat these images as durable data.
- **No durable phenotype without a TTL plan.** If a `parametric_result` is
  cached or logged for debugging, it must be covered by the same sweep
  discipline as the images.
- **Server-only catalog credentials.** Shopify Admin GraphQL credentials live
  in `tenant_integrations` and are read only in server routes. The widget
  never receives, stores, or proxies these credentials — it sends only
  `product_id` / `variant_id` / `sku`.
- **No secrets in client code.** Any token, API key, HuggingFace weight
  access, or Replicate credential is fetched via a server route or lives
  only on the Cog / `.env.local`. Never embed secrets in widget JS, client
  bundles, chat, or git.
- Gallery upload of biometric photos is **debug-only in the merchant
  dashboard sandbox** and must never be exposed on the live storefront —
  storefront capture is live-camera only.
- **Catalog honesty:** do not invent girths. `completeMeasurements` (or
  equivalent) must not set `measurementsFromSource` on filled-in values.
  Per-SKU ingest is the primary path; bulk sync is secondary.
- **Mannequin:** faceless and non-skin-toned. Do not infer or display skin
  color from photos.

---

## 9. State Management & TypeScript

- Keep capture-session and phenotype state colocated with the widget flow;
  do not introduce a new global store without approval.
- Local component state for anything transient (form fields mid-capture,
  gate status, GPU warm/sleep). Persist only what a session genuinely needs
  across a reload.
- Strict TypeScript. No `any`. Keep types simple, explicit, and colocated in
  `types/*` per the domain split in Section 5.5.
- Do not carry `mesh` / SMPL-X / ANNY types forward into new code once a
  slice removes their usage — delete dead types in the same commit that
  retires them.

---

## 10. Decision Boundaries

- **Ask before adding any new npm package.** `@mediapipe/tasks-vision` is
  already approved. Cog Python deps live in `cog/requirements.txt` and still
  need a brief check before adding anything heavy.
- **No `replicate` npm package.** Ever. Use `fetch` against the Replicate
  HTTP API (predictions **and** Deployments PATCH for `min_instances`).
- **No React Three Fiber.** Raw Three.js only, matching the existing
  `vfr-canvas.tsx` patterns.
- **Python only in `cog/`.** No local `backend/main.py` API.
- **All Replicate/GPU calls are live.** `REPLICATE_API_TOKEN`,
  `REPLICATE_HMR_MODEL_VERSION`, and `REPLICATE_DEPLOYMENT` point at **our
  Cog on `gpu-a100-large`**, not ANNY-Fit. Fail closed if any are missing.
  Do not add a mock branch, a fixture phenotype, or a "skip inference" flag.
  If HuggingFace access to SAM 3D Body weights is not granted, stop — do
  not stub the initializer.
- **Session GPU, not 24/7 cron.** Shopper path uses the Deployment.
  Test/sandbox: `min_instances=1` while the session is warm; `0` on Sleep
  or the 45-minute safety timeout. Do not keep-alive with dummy predictions
  against the ~$5 A100 credit.
- **Ask before changing existing UI** that isn't part of the current task's
  file map.
- **Ask before renaming or dropping a database column/table** that other
  phases depend on (especially `fit_jobs`, `tenant_id`, and anything in
  `garment_cad_profiles`).
- **Ask before editing AGENTS.md itself** to change locked product
  decisions (MHR topology `mhr-18439-127`, SAM 3D Body as initializer only,
  Newton in the Cog, GarmentCode MIT / never `NvidiaWarp-GarmentCode`,
  clearance heatmap, on-device head crop, session `min_instances`,
  confidence-gate formula, live-inference requirement,
  no-R3F / no-replicate-npm bans). Additive updates (e.g., adding a new
  file to the file map as a phase lands) do not require asking.
- If a request would require more than one npm package, more than one new
  major architectural pattern, or touching more than one phase's file map at
  once — stop and ask for scope confirmation before writing code.

---

## 11. Phase Roadmap

Each phase is an isolated, demoable vertical slice with its own contract.
Later phases consume earlier contracts; they do not rewrite earlier UI.
**Every phase starts by confirming this file's locks, then code, then a
demoable check on real Replicate + real Supabase.** If a phase's lock in
this file is stale, update AGENTS.md first (additive file-map edits are
fine; locked-decision edits still follow Section 10).

The previous ANNY-Fit roadmap is retired. SaaS shell work that already
landed (auth, onboarding, per-SKU Shopify ingest, clearance heatmap) is
kept and consumed — not redone.

| Phase | Deliverable | Depends on |
|---|---|---|
| **0 — AGENTS.md rewrite** | This file: MHR topology, A100 Cog, clearance heatmap, head crop, session `min_instances`, no ANNY-Fit, Newton in Cog, GarmentCode ingest | — |
| **1 — Privacy and capture** | Consent + age attestation, fitted-clothing copy, side wrist gate, on-device head crop into headless WebPs, optional Illinois ship flag, crop + wrist-gate tests. Demo: sandbox produces two headless WebPs; `/privacy` matches the checkbox. | 0 |
| **2 — Replicate A100 Cog + session-warm GPU** | `cog/` with live SAM 2 → SAM 3D Body init → MHR `task=body`; model + Deployment on `gpu-a100-large`; `REPLICATE_DEPLOYMENT` required; replace dummy keep-alive with PATCH `min_instances=1/0`; sandbox Warm / Sleep + 45-minute safety timeout. Demo: Warm A100 shows `min_instances=1` + `gpu-a100-large`; a real body predict returns MHR params or the **real** Replicate error. | 0 |
| **3 — App body contract (ANNY → MHR)** | `MhrParametricVector`; ship `mhr-hull.glb`; viewport + webhook/status parse MHR; wipe biometrics on success or failure; size rec + AND-gate; Approximate if clothing/height residual is large. Demo: Sandbox Try On shows a **real** MHR avatar from the live Cog, not a height-scaled dummy hull. | 1 + 2 |
| **4 — Newton drape on the same warm GPU** | Cog `task=drape`; collider = MHR LOD 3; clearance into sim-delta v2; `resolve-drape.ts` → Replicate; JS XPBD debug-only; cache hit optional; miss must not withhold size; 8s client deadline → Approximate. Demo: one SKU draped on the live avatar; heatmap toggle; loose regions blue. | 3 |
| **5 — Catalog honesty + GarmentCode** | Stop inventing girths; per-SKU primary; Cog `task=pattern` (Qwen3-VL-8B Apache 2.0 or HTML parse → GarmentCode); hard-reject self-intersection; cross-check size chart; grade by re-instantiating 2D pattern per size; unsupported styles = Approximate / no 3D; KES does not flip size. Ingest may cold-start. Demo: paste one product URL → one graded garment → visible tier/confidence → no invented chest=waist+16. | 0 |
| **6 — Texture and mannequin** | Faceless non-skin-toned mannequin, neutral undergarment, garment albedo on GarmentCode UVs; failed print QA → visualization off + Approximate; heatmap remains a toggle. Demo: shopper can recognize the SKU color; body is not a nude grey mesh. | 4 + 5 |
| **7 — Merchant lifecycle on a Shopify development store** | Invite → onboard → allowlist → Admin token → Test this SKU → Liquid block → Warm A100 → Try On → size to cart when AND-gate passes → Sleep A100. A Partner development store is a real shop with a real Admin API — not a mock JSON catalog. | 3 + 5 + 6 |

**Order is strict:** 0 → 1 → 2 → 3 → 4; 5 may run after 0 in parallel with
1–3; 6 after 4+5; 7 last. If a credential is missing, stop and ask — do
not mock.

**What a human must supply (never paste into chat or git):**

- Replicate token + permission to create a private model/deployment on A100
- HuggingFace access to **SAM 3D Body** weights (gated)
- Working Supabase project
- Phase 7: Shopify Partner development store + custom app (`read_products`)
- All of `REPLICATE_API_TOKEN`, `REPLICATE_HMR_MODEL_VERSION`,
  `REPLICATE_DEPLOYMENT`, `ASHRIUM_OPERATOR_SECRET`, and Supabase keys in
  **`.env.local` only**

**Definition of done (v1):** an invited merchant can accept the invite, set
their domain, connect a Shopify **development store**, install the Liquid
block, ingest **one SKU**, and open both the sandbox and the live storefront
Try On. A shopper can attest age, consent, enter height/sex/(weight), pass
guided front/side capture (head cropped on-device), see their real MHR
avatar from the live Cog, see a draped size with a clearance heatmap toggle,
and — when the AND-gate passes — get a size written into the cart. Photos
are gone immediately after inference. The return-rate dashboard reflects
real telemetry. `npm run dev` runs the app against the real Cog and the
real Supabase project using credentials in `.env.local` — no mock mode
anywhere.

---

## 12. Final Reminder

Read this file before every feature. Follow it strictly. Build the smallest
correct version of each phase slice against the live Replicate A100 Cog and
real Supabase project — no mocks, no stubs, no fixture data. Never mix MHR
and ANNY topology versions, never let a raw biometric photo or a face pixel
outlive its TTL, never leave `min_instances=1` overnight, and ask before
adding a package, changing locked product decisions, or touching a file
outside the current phase's map.
