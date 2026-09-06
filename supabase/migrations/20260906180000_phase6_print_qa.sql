-- Phase 6: product-image print QA. Failed QA hides 3D garment visualization
-- and forces Approximate. Size remains girths + the published chart.

ALTER TABLE public.garment_cad_profiles
  ADD COLUMN IF NOT EXISTS print_qa_passed BOOLEAN;

UPDATE public.garment_cad_profiles
SET print_qa_passed = (
  cad_pattern_url IS NOT NULL
  AND length(trim(cad_pattern_url)) > 0
)
WHERE print_qa_passed IS NULL;

ALTER TABLE public.garment_cad_profiles
  ALTER COLUMN print_qa_passed SET DEFAULT false;

ALTER TABLE public.garment_cad_profiles
  ALTER COLUMN print_qa_passed SET NOT NULL;

COMMENT ON COLUMN public.garment_cad_profiles.print_qa_passed IS
  'Product-image print QA. False hides 3D garment visualization and forces Approximate.';
