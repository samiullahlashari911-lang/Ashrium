-- Private, short-lived biometric source-image storage.

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'biometrics',
  'biometrics',
  false,
  5242880,
  ARRAY['image/jpeg']
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY biometrics_insert_tenant
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'biometrics'
    AND storage.extension(name) = 'jpg'
    AND (storage.foldername(name))[1] =
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
  );

-- The service role bypasses Storage RLS; these policies document and limit the
-- intended trusted-only read/delete surface for direct database access.
CREATE POLICY biometrics_select_service_role
  ON storage.objects
  FOR SELECT
  TO service_role
  USING (bucket_id = 'biometrics');

CREATE POLICY biometrics_delete_service_role
  ON storage.objects
  FOR DELETE
  TO service_role
  USING (bucket_id = 'biometrics');
