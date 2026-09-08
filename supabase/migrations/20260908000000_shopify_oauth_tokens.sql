-- Shopify OAuth: expiring offline access tokens + refresh token storage.

ALTER TABLE public.tenant_integrations
  ADD COLUMN shopify_token_expires_at TIMESTAMPTZ,
  ADD COLUMN shopify_refresh_token_ciphertext TEXT,
  ADD COLUMN shopify_refresh_token_expires_at TIMESTAMPTZ;
