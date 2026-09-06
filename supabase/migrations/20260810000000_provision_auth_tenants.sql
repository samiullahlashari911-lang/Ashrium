-- Provision an isolated merchant tenant for every newly registered Auth user.

CREATE TABLE IF NOT EXISTS public.tenants (
  id UUID PRIMARY KEY,
  company_name TEXT NOT NULL,
  owner_user_id UUID NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tenants_company_name_length_check
    CHECK (char_length(company_name) BETWEEN 1 AND 160)
);

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS owner_user_id UUID,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.tenants
  ALTER COLUMN owner_user_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.tenants'::regclass
      AND conname = 'tenants_owner_user_id_key'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_owner_user_id_key UNIQUE (owner_user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.tenants'::regclass
      AND conname = 'tenants_owner_user_id_fkey'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_owner_user_id_fkey
      FOREIGN KEY (owner_user_id) REFERENCES auth.users (id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.tenants'::regclass
      AND conname = 'tenants_company_name_length_check'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_company_name_length_check
      CHECK (char_length(company_name) BETWEEN 1 AND 160);
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS tenants_set_updated_at ON public.tenants;
CREATE TRIGGER tenants_set_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_self_access_policy ON public.tenants;
DROP POLICY IF EXISTS tenants_select_own ON public.tenants;
CREATE POLICY tenants_select_own
  ON public.tenants
  FOR SELECT
  USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS tenants_update_own ON public.tenants;
CREATE POLICY tenants_update_own
  ON public.tenants
  FOR UPDATE
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.provision_tenant_for_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  company_name TEXT;
BEGIN
  company_name := NULLIF(
    pg_catalog.btrim(
      COALESCE(NEW.raw_user_meta_data ->> 'company_name', '')
    ),
    ''
  );
  company_name := COALESCE(company_name, 'New Merchant');

  INSERT INTO public.tenants (id, company_name, owner_user_id)
  VALUES (NEW.id, company_name, NEW.id);

  -- Existing tenant-scoped tables reference merchants, so retain a matching
  -- merchant root with the same identifier during the transition to tenants.
  INSERT INTO public.merchants (id, name, domain, api_key_hash)
  VALUES (
    NEW.id,
    company_name,
    pg_catalog.concat('tenant-', NEW.id::TEXT, '.internal'),
    pg_catalog.md5(NEW.id::TEXT || pg_catalog.clock_timestamp()::TEXT)
  );

  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(
    raw_app_meta_data,
    '{}'::jsonb
  ) || pg_catalog.jsonb_build_object('tenant_id', NEW.id::TEXT)
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.provision_tenant_for_new_auth_user() FROM PUBLIC;

DROP TRIGGER IF EXISTS on_auth_user_created_provision_tenant ON auth.users;

CREATE TRIGGER on_auth_user_created_provision_tenant
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION private.provision_tenant_for_new_auth_user();
