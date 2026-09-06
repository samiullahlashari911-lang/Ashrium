-- Repair auth.users triggers that block operator provisioning via auth.admin.createUser.
-- Drop legacy auto-provision AND invite-only BEFORE INSERT triggers.
-- Portal access stays protected by: Supabase signup disabled + operator secret on invite API.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

DROP TRIGGER IF EXISTS on_auth_user_created_provision_tenant ON auth.users;
DROP FUNCTION IF EXISTS private.provision_tenant_for_new_auth_user();

DROP TRIGGER IF EXISTS enforce_invite_only_auth_users ON auth.users;
DROP FUNCTION IF EXISTS private.enforce_invite_only_auth_users();
