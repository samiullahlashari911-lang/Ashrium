-- Invite-only merchant portal: no tenant on public Auth signup.
-- Operator provisioning (service role) stamps invited_by before insert.

ALTER TABLE public.tenants
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active',
  ADD CONSTRAINT tenants_status_check
    CHECK (status IN ('active', 'suspended'));

DROP TRIGGER IF EXISTS on_auth_user_created_provision_tenant ON auth.users;
DROP FUNCTION IF EXISTS private.provision_tenant_for_new_auth_user();

CREATE OR REPLACE FUNCTION private.enforce_invite_only_auth_users()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(NEW.raw_app_meta_data ->> 'invited_by', '') IS DISTINCT FROM 'ashrium_operator' THEN
    RAISE EXCEPTION 'Ashrium merchant accounts are invite-only'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_invite_only_auth_users() FROM PUBLIC;

CREATE TRIGGER enforce_invite_only_auth_users
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_invite_only_auth_users();

CREATE OR REPLACE FUNCTION public.prevent_tenant_status_self_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND auth.role() = 'authenticated' THEN
    RAISE EXCEPTION 'Tenant status can only be changed by an operator';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_prevent_status_self_update ON public.tenants;

CREATE TRIGGER tenants_prevent_status_self_update
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_tenant_status_self_update();
