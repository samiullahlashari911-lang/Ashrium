-- One Shopify custom-distribution app per client (docs/specs/client-onboarding.md).
-- Additive only: rows without these columns keep using the shared app from
-- SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET.

ALTER TABLE public.tenant_integrations
  ADD COLUMN IF NOT EXISTS shopify_app_client_id TEXT,
  ADD COLUMN IF NOT EXISTS shopify_app_client_secret_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS shopify_install_url TEXT;

-- A client app belongs to exactly one tenant; webhooks and installs resolve
-- the tenant from it.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_integrations_shopify_app_client_id_key
  ON public.tenant_integrations (shopify_app_client_id)
  WHERE shopify_app_client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tenant_integrations_shopify_shop_domain_idx
  ON public.tenant_integrations (shopify_shop_domain)
  WHERE provider = 'shopify';

ALTER TABLE public.tenant_integrations
  DROP CONSTRAINT IF EXISTS tenant_integrations_shopify_app_pair_check,
  ADD CONSTRAINT tenant_integrations_shopify_app_pair_check CHECK (
    (shopify_app_client_id IS NULL) = (shopify_app_client_secret_ciphertext IS NULL)
  );

-- Which Shopify product a garment came from, so product webhooks can find it
-- (one product can yield several garments, one per colourway).
ALTER TABLE public.garment_cad_profiles
  ADD COLUMN IF NOT EXISTS shopify_product_id TEXT;

CREATE INDEX IF NOT EXISTS garment_cad_profiles_tenant_shopify_product_idx
  ON public.garment_cad_profiles (tenant_id, shopify_product_id)
  WHERE shopify_product_id IS NOT NULL;
