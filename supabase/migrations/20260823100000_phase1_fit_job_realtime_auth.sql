-- Phase 1: authorize exact private Realtime topic fit_job:{id} for signed-in
-- merchant sessions. Storefront embeds use the tenant-scoped polling route.

DROP POLICY IF EXISTS fit_job_broadcast_select_authenticated ON realtime.messages;
DROP POLICY IF EXISTS fit_job_broadcast_select_anon ON realtime.messages;

CREATE POLICY fit_job_broadcast_select_authenticated
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    CASE
      WHEN (SELECT realtime.topic()) ~
        '^fit_job:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN EXISTS (
        SELECT 1
        FROM public.fit_jobs
        WHERE id = split_part((SELECT realtime.topic()), ':', 2)::UUID
          AND tenant_id = public.get_current_tenant_id()
      )
      ELSE false
    END
  );
