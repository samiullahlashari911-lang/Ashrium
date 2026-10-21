# AGENTS.md — Ashrium Virtual Fitting Room (VFR)

The binding rules for this repo. Detail lives in
`docs/agents/spec-full.md`: the full file map (§5.5), dated owner decisions
for the UI and the shopper result (§6), body/drape pipeline detail (§7), and
the phase roadmap (§11). Read the section your task touches. If a request
conflicts with a rule here, stop and ask. Current status: `handoff.md`.

## 1. Product

Ashrium is a multi-tenant virtual fitting room embedded in Shopify
storefronts (WooCommerce later). A shopper attests 16+, consents, enters
height, sex and optional weight, and takes two guided photos (front A-pose,
side with wrists at or above the shoulders). The phone crops the head and
uploads two headless WebPs. The live GPU fits a **Meta MHR** body
(`mhr-18439-127`), drapes the merchant's real **GarmentCode** sewing pattern
(graded per size) with **Newton** on Modal, and the shopper sees **their own
photo wearing the garment** (the mirror view) plus a size. A hard size claim
is made only when the confidence AND-gate passes; otherwise "Approximate
fit". Commercial: $3,500 managed package per merchant + usage meters +
return-rate dashboard. No Stripe in v1.

**This build is fully functional, not a demo.** Every slice calls the real
Modal GPU, runs real MHR fit / Newton drape / GarmentCode ingest, and writes
real data to the real Supabase project. No mock inference, stub responses,
fixture phenotypes, invented girths, or "pretend this worked" branches —
anywhere.

## 2. Stack (locked)

| Layer | Choice |
|---|---|
| App | Next.js App Router, strict TypeScript (no `any`), Tailwind with `ash-*` tokens from `lib/design-tokens.ts` |
| Data | Supabase (Postgres, Storage, Realtime, tenant JWT) |
| 3D | **Raw Three.js** (WebGL), patterns from `components/vfr/vfr-canvas.tsx` |
| Pose / on-device | MediaPipe (`@mediapipe/tasks-vision`) |
| GPU | Our Python pipeline on **Modal A100-80GB** (fallback A100-40GB → L40S), HMAC HTTP `POST /body`, `/drape`, `/pattern`, `/session`, called only via `fetch` in `lib/ml/gpu.ts` |
| Body | SAM 2 silhouettes → SAM 3D Body (**initializer only**) → joint two-view MHR fit. Render LOD 1 (18,439 verts / 127 joints), cloth collider LOD 3 |
| Cloth | Newton (Style3D for sewn garments; XPBD/VBD allowed) inside the same warm Modal app. JS XPBD (`lib/graphics/xpbd-cloth.ts`) is debug-only |
| Patterns | GarmentCode / PyGarment core (MIT). **Never `NvidiaWarp-GarmentCode`** |
| Storefront | Shopify Liquid block + `public/vfr-widget.js` iframe |

## 3. Hard bans

- **No React Three Fiber.** **No `replicate` npm package.** Ever.
- **Python only in `gpu/`.** No local `backend/main.py` API.
- **No mocks, no fallback inference.** Fail closed if `MODAL_GPU_URL` or
  `ASHRIUM_GPU_HMAC` is missing; surface the real Modal error. If
  HuggingFace access to SAM 3D Body weights is missing, stop — do not stub.
- **No ANNY on new work:** never write `anny-13380-104` or
  `AnnyParametricVector` on new rows; ANNY-Fit is not the GPU.
- **No 24/7 keep-alive** (Vercel cron or dummy predictions) against the A100.
- No secrets in client code, widget JS, chat or git — `.env.local` / Modal
  secrets only.

## 4. Privacy and biometrics (never relax)

- Consent + 16+ attestation before any camera. `/privacy` matches the
  checkbox copy (`lib/privacy/consent-copy.ts`).
- Head cropped **on-device** before WebP (1024 px, q85). **No face pixels on
  any server.** Uploads use short-lived signed PUT URLs minted by the embed
  token, never a merchant credential.
- Biometric images: `image/webp` only, path `{tenant}/{job}/front|side.webp`,
  15-minute TTL, wiped immediately on inference success **or** failure
  (`lib/server/biometrics-wipe.ts`). Any cached phenotype is covered by the
  same TTL sweep (`/api/v1/cron/ttl-sweep`). Never reuse that cron to warm
  the GPU.
- Full camera frames, the face, the drape drawing and clothes removal stay
  **on the phone** (`OnDevicePhoto`, never a Blob) and are wiped when Try On
  closes. Servers never return images, never store appearance, never infer
  skin colour.
- The widget is a sandboxed iframe: it gets an embed token and
  `product_id`/`variant_id`/`sku` only — never merchant JWTs, Shopify Admin
  tokens or CAD data. Catalog/Shopify Admin calls are server-side only.
- Gallery upload of biometric photos is dashboard-sandbox debug only; the
  storefront is live-camera only. Illinois BIPA flag stays off until counsel.

## 5. Fit and simulation rules

- **Size number = body girths + the published size chart.** KES, clearance
  and the drape never change it. A drape miss never withholds a size.
- **Confidence AND-gate** for a solid badge + `VFR_SIZE_RECOMMENDED` cart
  write — ALL of: capture gates passed (incl. side wrists and head crop);
  garment ingest Tier 1 or pipeline-validated Tier 2; clothing/height
  residual in tolerance; drape landed (cache hit or Newton run, no client
  cutoff). Otherwise "Approximate fit", visibly different.
- Topology: stamp `topology_version` (`mhr-18439-127`) on every phenotype and
  cached delta. Measure girths on the **canonical-pose** mesh (ISO 8559-1
  plane slice + convex hull); silhouette is a weak term.
- Drape order: `simulation_cache` match (cosine ≥ 0.995, scoped by
  `variant_id` + `tenant_id`) → else Newton on Modal via
  `lib/fit/resolve-drape.ts`. Drape never blocks the body result; re-check
  the AND-gate whenever a late drape lands.
- Grade by **re-instantiating the 2D pattern per size**, never by 3D scaling.
  Unsupported geometry (hoods, lapels, long sleeves, jumpsuits, skirts, sets)
  is size-only with an Approximate badge.
- Shopper result = **mirror view** (their own Front/Side photo with the drape
  drawn in, the tried garment replacing their own clothes). No mannequin and
  no 3D avatar for shoppers; the 3D view is sandbox debug only. Never show a
  fake drape — say why and give one next step.
- **Three.js memory:** dispose every renderer, geometry, material and texture
  a session creates (follow `vfr-canvas.tsx`).

## 6. GPU session budget

GPU warms (`min_containers=1`) when the shopper passes consent. After
submit: up to 3 min `starting`, then 2 min of inference after `started_at`,
5 min total shopper wait — then cancel, fail the job, wipe photos,
`min_containers=0`. Abandoned capture sleeps after 4 min without a warmup
ping. Only the operator/cron scales via `POST /api/v1/hmr/keepalive`;
merchants cannot. Catalog ingest (`task=pattern`) may cold-start. Never
leave `min_containers=1` overnight.

## 7. API and database

- Product routes only under `/api/v1/*`. Every fit-job row and call carries
  `tenant_id`. Realtime topic `fit_job:{id}` only — no wildcards.
- Do not rename `fit_jobs`; extend it. `gltf_output_url` is legacy.
- `garment_cad_profiles` modes: A explicit KES, B chart + material (Tier 2),
  C category defaults (Approximate). Catalog honesty: never mark filled-in
  measurements as source-true.
- Detail of columns, buckets and the full file map: `docs/agents/spec-full.md`
  §5.4–§5.5.

## 8. How to work

- One vertical slice at a time; extend what exists, don't rebuild it. Touch
  only files the task needs; match existing patterns.
- Smallest working version. No speculative config, abstraction or edge-case
  handling. Refactor only when a pattern repeats 3+ times.
- Routine engineering choices: decide, state the choice in one line, and
  proceed (the owner delegates these). Ask only at the boundaries in §9.
- Done = verified: `npm run check` (typecheck + lint + tests) for the app,
  `gpu/tests/` pytest for GPU code, the drape grid (`gpu/dev_drape_grid.py`)
  before every GPU deploy, and a look at visual changes in the running app.
- Ship each user-visible slice: commit (never secrets), push `master`,
  confirm the Vercel production deploy. Localhost-only is not done.
- When a file is added for a phase, add it to the file map in
  `docs/agents/spec-full.md` §5.5.

## 9. Decision boundaries — ask first

- Adding any npm package (heavy GPU Python deps: a brief check).
- Changing existing UI outside the current task.
- Renaming or dropping a column/table other code depends on (`fit_jobs`,
  `tenant_id`, `garment_cad_profiles`, …).
- Changing any locked decision in §2–§6 (here or in `spec-full.md`).
- A request needing 2+ new packages, 2+ new architectural patterns, or work
  across several areas at once — confirm scope first.
- Anything only the owner can supply: Modal/HF/Supabase/Shopify credentials
  (never pasted into chat or git), spending, legal/privacy wording.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues on samiullahlashari911-lang/Ashrium (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
