-- Per-tenant storefront allowlists and tenant-visible security audit events.

ALTER TABLE public.tenants
  ADD COLUMN allowed_domains TEXT[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT tenants_allowed_domains_limit_check
    CHECK (cardinality(allowed_domains) <= 50);

CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('UNAUTHORIZED_DOMAIN_ACCESS', 'RATE_LIMIT_EXCEEDED')
  ),
  ip_address INET,
  user_agent TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_tenant_created_at_idx
  ON public.audit_logs (tenant_id, created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_logs_select_tenant
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = ((SELECT auth.jwt()) -> 'app_metadata' ->> 'tenant_id')::uuid
  );

REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM anon, authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;
