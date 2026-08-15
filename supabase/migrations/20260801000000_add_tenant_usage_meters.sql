-- Commercial plan controls and tenant-scoped fit-session metering.

ALTER TABLE public.merchants
  ADD COLUMN plan_tier TEXT NOT NULL DEFAULT 'starter',
  ADD COLUMN monthly_quota INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN overage_allowed BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT merchants_plan_tier_check
    CHECK (plan_tier IN ('starter', 'growth', 'scale', 'enterprise')),
  ADD CONSTRAINT merchants_monthly_quota_check
    CHECK (monthly_quota >= 0);

-- Tenants may not modify billing controls through the authenticated Data API.
REVOKE UPDATE ON public.merchants FROM anon, authenticated;
GRANT UPDATE (name, domain) ON public.merchants TO authenticated;

CREATE TABLE public.tenant_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.merchants (id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  replicate_api_key_ciphertext TEXT,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tenant_integrations_provider_check CHECK (provider = 'replicate'),
  CONSTRAINT tenant_integrations_tenant_provider_unique UNIQUE (tenant_id, provider),
  CONSTRAINT tenant_integrations_active_key_check CHECK (
    NOT is_active OR NULLIF(replicate_api_key_ciphertext, '') IS NOT NULL
  )
);

CREATE TRIGGER tenant_integrations_set_updated_at
  BEFORE UPDATE ON public.tenant_integrations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.tenant_integrations ENABLE ROW LEVEL SECURITY;

-- Integration secrets are never readable or writable through the client Data API.
CREATE POLICY tenant_integrations_no_client_access
  ON public.tenant_integrations
  AS RESTRICTIVE
  FOR ALL
  USING (false)
  WITH CHECK (false);

CREATE TABLE public.tenant_usage_meters (
  tenant_id UUID NOT NULL REFERENCES public.merchants (id) ON DELETE CASCADE,
  billing_period_start DATE NOT NULL,
  fit_sessions_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, billing_period_start),
  CONSTRAINT tenant_usage_meters_period_start_check
    CHECK (billing_period_start = date_trunc('month', billing_period_start)::DATE),
  CONSTRAINT tenant_usage_meters_fit_sessions_count_check
    CHECK (fit_sessions_count >= 0)
);

CREATE TRIGGER tenant_usage_meters_set_updated_at
  BEFORE UPDATE ON public.tenant_usage_meters
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.tenant_usage_meters ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_usage_meters_select_tenant
  ON public.tenant_usage_meters
  FOR SELECT
  USING (tenant_id = public.get_current_tenant_id());

REVOKE ALL ON public.tenant_usage_meters FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.increment_fit_session_counter(p_tenant_id UUID)
RETURNS TABLE (
  fit_sessions_count INTEGER,
  monthly_quota INTEGER,
  overage_allowed BOOLEAN,
  plan_tier TEXT,
  quota_exceeded BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  current_period_start DATE := date_trunc('month', timezone('UTC', now()))::DATE;
  tenant_plan_tier TEXT;
  tenant_monthly_quota INTEGER;
  tenant_overage_allowed BOOLEAN;
  next_fit_sessions_count INTEGER;
  exceeded_quota BOOLEAN;
BEGIN
  SELECT merchants.plan_tier, merchants.monthly_quota, merchants.overage_allowed
  INTO tenant_plan_tier, tenant_monthly_quota, tenant_overage_allowed
  FROM public.merchants
  WHERE merchants.id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown tenant: %', p_tenant_id
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.tenant_usage_meters (
    tenant_id,
    billing_period_start,
    fit_sessions_count
  )
  VALUES (p_tenant_id, current_period_start, 1)
  ON CONFLICT (tenant_id, billing_period_start)
  DO UPDATE SET fit_sessions_count = public.tenant_usage_meters.fit_sessions_count + 1
  RETURNING tenant_usage_meters.fit_sessions_count INTO next_fit_sessions_count;

  exceeded_quota := next_fit_sessions_count > tenant_monthly_quota
    AND NOT tenant_overage_allowed;

  IF exceeded_quota THEN
    UPDATE public.tenant_usage_meters
    SET fit_sessions_count = fit_sessions_count - 1
    WHERE tenant_id = p_tenant_id
      AND billing_period_start = current_period_start
    RETURNING tenant_usage_meters.fit_sessions_count INTO next_fit_sessions_count;
  END IF;

  RETURN QUERY
  SELECT
    next_fit_sessions_count,
    tenant_monthly_quota,
    tenant_overage_allowed,
    tenant_plan_tier,
    exceeded_quota;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_fit_session_counter(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_fit_session_counter(UUID) TO service_role;
