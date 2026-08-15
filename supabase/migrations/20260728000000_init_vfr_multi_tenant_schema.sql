-- VFR Multi-Tenant Schema Initialization
-- Strict Row Level Security (RLS) isolated by tenant_id from auth.jwt() app_metadata.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- merchants (tenant root)
-- ============================================================================
CREATE TABLE public.merchants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE,
  api_key_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- garment_cad_profiles
-- CAD mechanical factors:
--   tensile_stiffness  S_t  (N/m)
--   bending_rigidity   B_r  (N*m)
--   shear_stiffness    S_s  (N/m)
--   area_density       rho_a (kg/m^2)
-- ============================================================================
CREATE TABLE public.garment_cad_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.merchants (id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  tensile_stiffness DOUBLE PRECISION NOT NULL,
  bending_rigidity DOUBLE PRECISION NOT NULL,
  shear_stiffness DOUBLE PRECISION NOT NULL,
  area_density DOUBLE PRECISION NOT NULL,
  cad_pattern_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT garment_cad_profiles_tenant_sku_unique UNIQUE (tenant_id, sku)
);

CREATE INDEX garment_cad_profiles_tenant_id_idx
  ON public.garment_cad_profiles (tenant_id);

-- ============================================================================
-- biometric_meshes (TTL-backed session meshes)
-- ============================================================================
CREATE TABLE public.biometric_meshes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.merchants (id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  mesh_object_path TEXT NOT NULL,
  is_processed BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX biometric_meshes_tenant_id_idx
  ON public.biometric_meshes (tenant_id);

-- Supports efficient expiry sweeps and TTL cleanup jobs.
CREATE INDEX biometric_meshes_expires_at_idx
  ON public.biometric_meshes (expires_at);

-- ============================================================================
-- Tenant resolution from Supabase Auth JWT
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_current_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(
    auth.jwt() -> 'app_metadata' ->> 'tenant_id',
    ''
  )::UUID;
$$;

-- ============================================================================
-- updated_at maintenance for merchants
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER merchants_set_updated_at
  BEFORE UPDATE ON public.merchants
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- Row Level Security
-- ============================================================================
ALTER TABLE public.merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garment_cad_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.biometric_meshes ENABLE ROW LEVEL SECURITY;

-- merchants: each JWT may only access its own tenant record
CREATE POLICY merchants_select_own
  ON public.merchants
  FOR SELECT
  USING (id = public.get_current_tenant_id());

CREATE POLICY merchants_update_own
  ON public.merchants
  FOR UPDATE
  USING (id = public.get_current_tenant_id())
  WITH CHECK (id = public.get_current_tenant_id());

-- garment_cad_profiles: full tenant-scoped CRUD
CREATE POLICY garment_cad_profiles_select_tenant
  ON public.garment_cad_profiles
  FOR SELECT
  USING (tenant_id = public.get_current_tenant_id());

CREATE POLICY garment_cad_profiles_insert_tenant
  ON public.garment_cad_profiles
  FOR INSERT
  WITH CHECK (tenant_id = public.get_current_tenant_id());

CREATE POLICY garment_cad_profiles_update_tenant
  ON public.garment_cad_profiles
  FOR UPDATE
  USING (tenant_id = public.get_current_tenant_id())
  WITH CHECK (tenant_id = public.get_current_tenant_id());

CREATE POLICY garment_cad_profiles_delete_tenant
  ON public.garment_cad_profiles
  FOR DELETE
  USING (tenant_id = public.get_current_tenant_id());

-- biometric_meshes: full tenant-scoped CRUD
CREATE POLICY biometric_meshes_select_tenant
  ON public.biometric_meshes
  FOR SELECT
  USING (tenant_id = public.get_current_tenant_id());

CREATE POLICY biometric_meshes_insert_tenant
  ON public.biometric_meshes
  FOR INSERT
  WITH CHECK (tenant_id = public.get_current_tenant_id());

CREATE POLICY biometric_meshes_update_tenant
  ON public.biometric_meshes
  FOR UPDATE
  USING (tenant_id = public.get_current_tenant_id())
  WITH CHECK (tenant_id = public.get_current_tenant_id());

CREATE POLICY biometric_meshes_delete_tenant
  ON public.biometric_meshes
  FOR DELETE
  USING (tenant_id = public.get_current_tenant_id());
