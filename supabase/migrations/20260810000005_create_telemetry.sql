-- Tenant-scoped order and return telemetry for performance reporting.

ALTER TABLE public.tenant_integrations
  ADD COLUMN telemetry_webhook_secret_ciphertext TEXT;

ALTER TABLE public.tenant_integrations
  DROP CONSTRAINT tenant_integrations_provider_check,
  DROP CONSTRAINT tenant_integrations_active_key_check,
  ADD CONSTRAINT tenant_integrations_provider_check
    CHECK (provider IN ('replicate', 'telemetry')),
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
    );

CREATE TABLE public.store_telemetry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  order_id TEXT NOT NULL CHECK (char_length(order_id) BETWEEN 1 AND 256),
  sku TEXT NOT NULL CHECK (char_length(sku) BETWEEN 1 AND 128),
  vfr_used BOOLEAN NOT NULL DEFAULT false,
  returned BOOLEAN NOT NULL DEFAULT false,
  return_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT store_telemetry_tenant_order_sku_unique UNIQUE (tenant_id, order_id, sku)
);

CREATE INDEX store_telemetry_tenant_created_at_idx
  ON public.store_telemetry (tenant_id, created_at DESC);

CREATE INDEX store_telemetry_tenant_vfr_returned_idx
  ON public.store_telemetry (tenant_id, vfr_used, returned);

CREATE TRIGGER store_telemetry_set_updated_at
  BEFORE UPDATE ON public.store_telemetry
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.store_telemetry ENABLE ROW LEVEL SECURITY;

CREATE POLICY store_telemetry_select_tenant
  ON public.store_telemetry
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = ((SELECT auth.jwt()) -> 'app_metadata' ->> 'tenant_id')::uuid
  );

REVOKE INSERT, UPDATE, DELETE ON public.store_telemetry FROM anon, authenticated;
GRANT SELECT ON public.store_telemetry TO authenticated;
