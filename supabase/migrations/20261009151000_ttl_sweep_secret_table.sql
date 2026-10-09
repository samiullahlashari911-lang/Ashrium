-- The Management API cannot write Supabase Vault, so the sweep's secret and
-- URL can also live in a private table that no client role can reach.
-- Set them (never in git):
--   insert into private.app_secrets (name, value) values
--     ('ashrium_cron_secret', '<CRON_SECRET>'),
--     ('ashrium_app_base_url', 'https://www.ashrium.org')
--   on conflict (name) do update set value = excluded.value, updated_at = now();

CREATE TABLE IF NOT EXISTS private.app_secrets (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

REVOKE ALL ON private.app_secrets FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON private.app_secrets FROM anon, authenticated;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.call_ttl_sweep()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cron_secret text;
  app_base_url text;
BEGIN
  SELECT value INTO cron_secret FROM private.app_secrets WHERE name = 'ashrium_cron_secret';
  SELECT value INTO app_base_url FROM private.app_secrets WHERE name = 'ashrium_app_base_url';

  IF cron_secret IS NULL THEN
    SELECT decrypted_secret INTO cron_secret FROM vault.decrypted_secrets WHERE name = 'ashrium_cron_secret';
  END IF;
  IF app_base_url IS NULL THEN
    SELECT decrypted_secret INTO app_base_url FROM vault.decrypted_secrets WHERE name = 'ashrium_app_base_url';
  END IF;

  IF cron_secret IS NULL OR app_base_url IS NULL THEN
    RAISE NOTICE 'ashrium ttl sweep: ashrium_cron_secret / ashrium_app_base_url are not set';
    RETURN;
  END IF;

  PERFORM net.http_get(
    url := rtrim(app_base_url, '/') || '/api/v1/cron/ttl-sweep',
    headers := jsonb_build_object('Authorization', 'Bearer ' || cron_secret),
    timeout_milliseconds := 60000
  );
END;
$$;

REVOKE ALL ON FUNCTION private.call_ttl_sweep() FROM PUBLIC;
