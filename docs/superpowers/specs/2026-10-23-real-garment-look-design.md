# Real garment look in the mirror view — design + plan (2026-10-23)

## Intent (owner)
"I want everything of the shirt, so the shirt looks real" — the drape in the
shopper's photo must look like the store's actual product (colour, fabric,
print, seams, buttons, pockets), not a flat grey shape. No AI image
generation: the product photo is the only source of the look, as on the
GarmentCode site (physics drape + the real fabric on the sewn pieces).

## Why it looks cartoonish today
`components/vfr/mirror-view.tsx` paints the drape with one colour
(`garment.colorHex` or the photo's mean) plus a procedural knit. The product
photo (`garment_cad_profiles.cad_pattern_url`, Shopify CDN, CORS `*`) is only
used for that mean colour.

## Facts that shape the design
- One product photo per product, shared by every colour variant; 9 of 10 are
  worn by a model (hands, bags, hair, other clothes in view), 1 is a clean
  product shot (crewneck).
- Drape `uv` = 2D GarmentCode pattern position in metres. Front/back and
  left/right pieces overlap in that space; seam triangles span pieces (huge
  uv stretch). There is no per-vertex panel id on the phone.

## Design (on the phone, no server, no new packages)
1. **Find the garment in the product photo** (`lib/widget/product-look.ts`):
   load the photo (crossOrigin), downscale, run the existing clothes
   segmenter; when it sees no person (product shot) fall back to "not the
   border colour". Pick the garment out of all clothes by colour clustering,
   seeded in the upper (tops) or lower (bottoms) part of the clothes mask.
2. **Lift the fabric** (`lib/graphics/garment-look.ts`, pure): divide out the
   photo's low-frequency light, take the cleanest interior patch, make it tile
   seamlessly; physical scale from the photo's garment width vs the chart
   (front width ≈ chest / 2).
3. **Front print map:** the de-lit garment region with an alpha where the
   garment is seen (hands/bags/hair = 0), plus per-row left/right edges.
4. **Mirror shader:** fabric tiled in pattern space (grain follows each
   piece); front-facing torso vertices of the draped garment get print
   coordinates by matching the drape's front silhouette rows to the photo's
   rows (shoulder→hem, side→side); seam triangles (uv/3D stretch > 3) draw a
   seam line in the fabric colour; existing photo light, folds, occlusion and
   rim stay.
5. **Colour variants:** when the variant colour (colourway) differs clearly
   from the photo's garment colour, keep the texture's detail and recolour.

## Non-goals / anti-goals
- No generated pixels, no server image round trip (AGENTS.md §4).
- Never paint a hand, bag or someone else's clothes onto the shopper.
- The size, fit and physics drape are unchanged.

## Plan
1. `garment-look.ts` pure functions + `tests/garment-look.test.ts`.
2. `product-look.ts` browser loader (cache per URL, disposes canvases).
3. Mirror shader + attributes; textures disposed with the renderer.
4. Verify offline (`/dev/mirror` fixtures with the real product URLs) on the
   crewneck, the waffle shirt and the corduroy pants; blind A/B vs today.
5. `npm run check`, commit, push, Vercel.
