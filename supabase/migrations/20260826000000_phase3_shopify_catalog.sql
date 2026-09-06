-- Phase 3: Shopify Admin credentials, variant SKU lookup, rest-length CAD storage.

ALTER TABLE public.tenant_integrations
  ADD COLUMN shopify_shop_domain TEXT,
  ADD COLUMN shopify_admin_token_ciphertext TEXT;

ALTER TABLE public.tenant_integrations
  DROP CONSTRAINT tenant_integrations_provider_check,
  DROP CONSTRAINT tenant_integrations_active_secret_check,
  ADD CONSTRAINT tenant_integrations_provider_check
    CHECK (provider IN ('replicate', 'telemetry', 'shopify')),
  ADD CONSTRAINT tenant_integrations_shopify_domain_check
    CHECK (
      shopify_shop_domain IS NULL
      OR shopify_shop_domain ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'
    ),
  ADD CONSTRAINT tenant_integrations_active_secret_check
    CHECK (
      NOT is_active
      OR (
        provider = 'replicate'
        AND NULLIF(replicate_api_key_ciphertext, '') IS NOT NULL
      )
      OR (
        provider = 'telemetry'
        AND NULLIF(telemetry_webhook_secret_ciphertext, '') IS NOT NULL
      )
      OR (
        provider = 'shopify'
        AND NULLIF(shopify_admin_token_ciphertext, '') IS NOT NULL
        AND NULLIF(shopify_shop_domain, '') IS NOT NULL
      )
    );

ALTER TABLE public.garment_size_variants
  ADD COLUMN external_sku TEXT,
  ADD CONSTRAINT garment_size_variants_external_sku_length_check
    CHECK (external_sku IS NULL OR char_length(external_sku) BETWEEN 1 AND 128);

CREATE UNIQUE INDEX garment_size_variants_tenant_external_sku_uidx
  ON public.garment_size_variants (tenant_id, external_sku)
  WHERE external_sku IS NOT NULL;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'garment-cad',
  'garment-cad',
  false,
  1048576,
  ARRAY['application/json']
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY garment_cad_select_service_role
  ON storage.objects
  FOR SELECT
  TO service_role
  USING (bucket_id = 'garment-cad');

CREATE POLICY garment_cad_insert_service_role
  ON storage.objects
  FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'garment-cad');

CREATE POLICY garment_cad_update_service_role
  ON storage.objects
  FOR UPDATE
  TO service_role
  USING (bucket_id = 'garment-cad')
  WITH CHECK (bucket_id = 'garment-cad');

CREATE POLICY garment_cad_delete_service_role
  ON storage.objects
  FOR DELETE
  TO service_role
  USING (bucket_id = 'garment-cad');
