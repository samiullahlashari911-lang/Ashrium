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
