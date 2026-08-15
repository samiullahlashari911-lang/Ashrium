-- Security hardening for short-lived biometric processing artifacts.

ALTER TABLE public.biometric_meshes
  ADD COLUMN source_image_object_path TEXT,
  ADD COLUMN processed_at TIMESTAMPTZ,
  ADD CONSTRAINT biometric_meshes_expiry_after_creation
    CHECK (expires_at > created_at);

CREATE OR REPLACE FUNCTION public.delete_expired_biometric_mesh_metadata()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.biometric_meshes
  WHERE expires_at <= now();

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_expired_biometric_mesh_metadata() FROM PUBLIC;

-- Object deletion is executed by the trusted worker immediately after mesh extraction.
-- This private bucket never exposes source images through public URLs.
INSERT INTO storage.buckets (id, name, public)
VALUES ('biometric-transient', 'biometric-transient', false)
ON CONFLICT (id) DO UPDATE SET public = false;

CREATE POLICY biometric_transient_objects_tenant_access
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (
    bucket_id = 'biometric-transient'
    AND (storage.foldername(name))[1] = public.get_current_tenant_id()::TEXT
  )
  WITH CHECK (
    bucket_id = 'biometric-transient'
    AND (storage.foldername(name))[1] = public.get_current_tenant_id()::TEXT
  );
