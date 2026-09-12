-- Shopify Size options must persist even when the merchant has not published
-- every girth. Unpublished cells stay NULL. Do not invent chest/waist/hip/length.

ALTER TABLE public.garment_size_variants
  ALTER COLUMN chest_cm DROP NOT NULL,
  ALTER COLUMN waist_cm DROP NOT NULL,
  ALTER COLUMN hip_cm DROP NOT NULL,
  ALTER COLUMN length_cm DROP NOT NULL;

ALTER TABLE public.garment_size_variants
  DROP CONSTRAINT IF EXISTS garment_size_variants_measurements_check;

ALTER TABLE public.garment_size_variants
  ADD CONSTRAINT garment_size_variants_measurements_check
  CHECK (
    (chest_cm IS NULL OR chest_cm > 0)
    AND (waist_cm IS NULL OR waist_cm > 0)
    AND (hip_cm IS NULL OR hip_cm > 0)
    AND (length_cm IS NULL OR length_cm > 0)
  );
