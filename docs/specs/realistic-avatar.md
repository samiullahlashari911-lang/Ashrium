# Realistic avatar: you, in the selected garment (2026-10-09)

Agreed with the owner in grilling (Q1–Q10, all "as recommended"). Nothing in
here is built until the owner confirms this plan and the AGENTS.md lock
changes below.

## Decisions

| # | Decision |
|---|---|
| Q1 | **Photo-textured 3D avatar + Newton drape.** The shopper's own front/side photos are projected onto their fitted MHR body **on the phone**; the selected garment is draped on the GPU and covers what it replaces. No generative 2D try-on (fit would be invented; licences are non-commercial; needs face pixels on a server). |
| Q2 | **Own appearance, on-device only.** Face, hair, skin and own clothes are painted on the avatar in the browser. Servers still receive only headless photos and never store appearance. Replaces the "faceless, non-skin-toned mannequin" lock. Counsel review before a paying store goes live. |
| Q3 | **Reveal only when dressed.** The loader stays until the recommended size's drape lands. If drape fails: the shopper in their own clothes + an honest message. Hold cap = measured drape p95 + 20 % (replaces the 90 s cap). |
| Q4 | Face fix is part of this build (the face comes from the same projection). The current face decal is retired. |
| Q5 | **Garment zone skin fill + capture copy.** Inside the zone the garment replaces (top → torso + arms, bottom → hips + legs), any surface the new garment does not cover is painted with a skin colour sampled on-device from the shopper's own face. Outside the zone: the photo, unchanged. Capture asks for a fitted short-sleeve T-shirt and fitted trousers/leggings. |
| Q6 | **Back = nearest seen colour.** Unseen vertices take the photo projection ignoring occlusion (front for body, side for head/hair). No third photo in v1. |
| Q7 | Keep the current A-pose. Relaxed arms is a later follow-up. |
| Q8 | Fit shown by: drape on you + tight/loose toggle + one plain line from regional clearance (e.g. "Snug at chest · relaxed at waist") + label "3D simulation of you from your measurements". |
| Q9 | If the photo cannot texture the avatar (blur, dark, face not found) → retake that photo with the reason. Capture gates check light and sharpness first. Never the mannequin. |
| Q10 | Always on. No merchant or shopper switch. |
| Q11 | **Suits = two linked pieces** (jacket + trousers ingested and draped together, replacing top and bottom). Built after this release; until then a store's separate jacket/trousers products work, and a single-product suit shows Best match (size only, no 3D). |
| Q12 | **Outerwear layers over** the shopper's own top (their shirt shows at the open front/collar); it replaces nothing. |
| Q13 | **One garment at a time** in this release; top + bottom together comes with Q11's two-piece drape. |
| Q14 | Where the shopper's own outfit cannot be replaced cleanly (a dress under a tried top), the photo shows as it is; the capture tip asks for a fitted T-shirt and trousers. |

## Why the current face looks cut and stretched (facts)

- `sealMannequinHead` reshapes the real MHR head into an ellipsoid "egg".
- `buildFaceDecalGeometry` maps a box UV over that egg; the crop canvas
  (eyes − 1.8 × eye-to-mouth … mouth + 1.1 ×) is stretched chin → crown, so
  forehead and hair are missing and the face is distorted.
- `public/models/mhr-hull.glb` has no UVs, so nothing else of the photo can be used.

## How it works

1. **GPU (`gpu/body/mhr_fit.py`)** already computes, per vertex, where the
   fitted front/side meshes land in each photo (`_project_points`). Return
   them: `photo_uv.front`, `photo_uv.side` (pixel coords in the uploaded
   headless WebP) and per-view visibility (coarse z-buffer + facing test).
   Geometry only, no pixels; same 15-minute TTL as `parametric_result`.
2. **Phone (`capture-viewport.tsx`, `webp-encode.ts`)** keeps the full front
   and side camera frames as canvases (never Blobs) plus the head-crop box and
   WebP scale, in memory only, dropped when Try On closes. The head-crop box
   maps headless pixel coords back to full-frame coords, so head and hair
   vertices sample the full frame without the GPU ever seeing them.
3. **Head alignment on the phone.** The GPU never sees the head, so its head
   pose is a guess. Correct it with a 2D similarity transform from the
   projected MHR eye/nose/mouth vertices to the MediaPipe landmarks of the
   same frame. This is the "rotated / cut" fix.
4. **Shader (`anny-canvas.tsx` + new `lib/graphics/photo-skin.ts`)**: the body
   keeps the real MHR head (no egg), samples the front/side frames per
   fragment from interpolated per-vertex UVs (full photo resolution, not
   per-vertex colour), blends by visibility and facing, uses lighting that
   does not double-shade the photo. Disposed with the session.
5. **Garment zone (`gpu/tools/build_body_parts.py` → `public/models/mhr-parts.bin`)**:
   per-vertex body part labels from MHR skinning weights, generated offline
   once per topology (no biometrics). Zone surfaces get the on-device skin colour.
6. **Reveal (`StorefrontViewport.tsx`)**: hold until dressed; cap from measured drape p95.
7. **Copy**: capture tip (fitted short-sleeve T-shirt, fitted trousers),
   consent bullet, `/privacy`, fit line, simulation label.

## Slices (each shipped and checked on the live app)

| Slice | Done when |
|---|---|
| S0 Chest girth fix deploy (owner runs `modal deploy`) | A new Try On shows a plausible chest (~95 cm for the owner) and not XL |
| S1 GPU returns photo UVs + visibility | Unit test on a synthetic mesh/camera; live job has `photo_uv` for 18,439 vertices |
| S2 Phone keeps full frames in memory | Test: frames are canvases, never Blob/URL, released on close |
| S3 Photo-textured body + head alignment (diagnosing-bugs loop) | Loop: eye/nose/mouth reprojection error ≤ 2 % of face height, eye line ≤ 3° from level, crop includes crown. Owner sees his own face upright, hair included |
| S4 Garment zone + skin fill | Trying a T-shirt over long sleeves shows skin below the new sleeve |
| S5 Reveal only when dressed | No undressed avatar is ever shown; drape failure shows own clothes + message |
| S6 Fit line + label + capture copy | Visible in the sandbox and storefront |

S1 needs a Modal deploy by the owner (production deploys are blocked for the agent).

## Known deviations (after code review, 2026-10-09)

- Q6 as built: unseen areas are a **smooth diffused colour** from confidently
  seen neighbours (mesh Laplacian), with the measured hair colour seeded on
  the back of the head, and the photo fades into it over a feathered band.
  Projecting through the body (the original wording) put buttons on the back
  and the face on the back of the head; copying single texels streaked.
- The viewer turns at most **65 degrees** each side and sways +-30 degrees on
  reveal (it used to spin 360 and showed the never-photographed back first).
- Camera capture asks for 1920x1440 (was 960x720); the side photo is matched
  to the front photo's exposure; a soft fixed key light shades the body.

- Reveal cap is the server drape budget (`GPU_HOLD_DURING_DRAPE_MS`) + 15 s,
  not a measured p95 + 20 %: no drape timings are recorded yet. Revisit with
  the GPU cost work.
- Body part labels are traced geometrically on the MHR mean A-pose
  (`gpu/tools/build_body_parts.py`), not from skinning weights: the weights
  live in the gated 696 MB MHR model, which is not on the dev machine.

## AGENTS.md lock changes (need the owner's explicit yes)

- §2 / §6 "3D drape viewport" and §8 "Mannequin": faceless non-skin-toned
  mannequin → **the shopper's own appearance (face, hair, skin, own clothes)
  projected from their photos on their device only; servers receive only
  headless photos and never store appearance; counsel review before a paying
  store goes live.** Stored artifacts and server renders stay faceless.
- §6 consent / fitted clothing: capture asks for a fitted short-sleeve T-shirt
  and fitted trousers or leggings.
- §7 drape reveal: replace the undergarment-first reveal and the 90 s
  `REVEAL_HOLD_MAX_MS` with "reveal only when dressed; cap = measured drape
  p95 + 20 %; drape failure shows the shopper in their own clothes".
- §5.5 file map (additive): `lib/graphics/photo-skin.ts`,
  `gpu/tools/build_body_parts.py`, `public/models/mhr-parts.bin`.

## Mirror view (owner decision 2026-10-09, after the painted 3D avatar was rejected as "looks like a 3D model")

| # | Decision |
|---|---|
| Q15 | Prototype offline on the landing-page model photos (real GPU drape, real photo) and get the owner's yes on the images **before** any app change. |
| Q16 | Clean studio backdrop with a soft floor shadow; the shopper is cut out on the phone (MediaPipe segmentation, approved package; nothing uploaded). |
| Q17 | Front and side photo views with a toggle; the 3D turn view leaves the shopper screen; the tight/loose heatmap is an overlay on the photo. |
| Q18 | **The tried garment fully replaces what it stands for.** The old top's pixels are removed (MediaPipe multi-class "clothes", split top/bottom by the fitted body's parts); where the new garment does not cover, the shopper's fitted body shows in their skin tone, or the backdrop beyond the body outline. |
| Q19 | The garment is lit to match the photo (brightness and warmth from the photo) with soft contact shadows, so it sits in the photo. |

How: the GPU already returns where every body vertex lands in each photo
(`photo_uv`). Garment vertices are carried from the canonical body (where
Newton drapes) into the photo through a per-vertex local affine map of the
body's own projection, so no extra GPU work is needed for the overlay.
