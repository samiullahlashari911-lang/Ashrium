-- Every 10 minutes Supabase calls the app's privacy sweep
-- (GET /api/v1/cron/ttl-sweep), which deletes biometric photos older than
-- 15 minutes and clears expired body results. Vercel's free plan only runs
-- daily crons, so the schedule lives here.
--
-- The secret and the app URL live in Supabase Vault, never in git:
--   select vault.create_secret('<CRON_SECRET>', 'ashrium_cron_secret');
--   select vault.create_secret('https://www.ashrium.org', 'ashrium_app_base_url');
-- Without them the job does nothing and logs a notice.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE SCHEMA IF NOT EXISTS private;

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
  SELECT decrypted_secret INTO cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'ashrium_cron_secret';

  SELECT decrypted_secret INTO app_base_url
  FROM vault.decrypted_secrets
  WHERE name = 'ashrium_app_base_url';

  IF cron_secret IS NULL OR app_base_url IS NULL THEN
    RAISE NOTICE 'ashrium ttl sweep: vault secrets ashrium_cron_secret / ashrium_app_base_url are missing';
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

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ashrium-ttl-sweep-http';

SELECT cron.schedule(
  'ashrium-ttl-sweep-http',
  '*/10 * * * *',
  $$SELECT private.call_ttl_sweep()$$
);
