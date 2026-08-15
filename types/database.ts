/**
 * Typed PostgreSQL schema for the VFR multi-tenant Supabase database.
 * Zero usage of 'any' in compliance with AGENTS.md guardrails.
 */

export type Json =
  | boolean
  | null
  | number
  | string
  | { [key: string]: Json | undefined }
  | Json[];

/** Garment mechanical properties as persisted by garment_cad_profiles. */
export type GarmentCadMechanicalColumns = {
  tensile_stiffness: number;
  bending_rigidity: number;
  shear_stiffness: number;
  area_density: number;
};

export type MerchantRow = {
  id: string;
  name: string;
  domain: string;
  api_key_hash: string;
  plan_tier: 'starter' | 'growth' | 'scale' | 'enterprise';
  monthly_quota: number;
  overage_allowed: boolean;
  created_at: string;
  updated_at: string;
};

export type MerchantInsert = {
  id?: string;
  name: string;
  domain: string;
  api_key_hash: string;
  plan_tier?: 'starter' | 'growth' | 'scale' | 'enterprise';
  monthly_quota?: number;
  overage_allowed?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type MerchantUpdate = {
  id?: string;
  name?: string;
  domain?: string;
  api_key_hash?: string;
  plan_tier?: 'starter' | 'growth' | 'scale' | 'enterprise';
  monthly_quota?: number;
  overage_allowed?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type TenantRow = {
  id: string;
  company_name: string;
  owner_user_id: string;
  allowed_domains: string[];
  created_at: string;
  updated_at: string;
};

export type TenantInsert = {
  id: string;
  company_name: string;
  owner_user_id: string;
  allowed_domains?: string[];
  created_at?: string;
  updated_at?: string;
};

export type TenantUpdate = {
  id?: string;
  company_name?: string;
  owner_user_id?: string;
  allowed_domains?: string[];
  created_at?: string;
  updated_at?: string;
};

export type GarmentCadProfileRow = GarmentCadMechanicalColumns & {
  id: string;
  tenant_id: string;
  sku: string;
  name: string;
  cad_pattern_url: string | null;
  created_at: string;
};

export type GarmentCadProfileInsert = GarmentCadMechanicalColumns & {
  id?: string;
  tenant_id: string;
  sku: string;
  name: string;
  cad_pattern_url?: string | null;
  created_at?: string;
};

export type GarmentCadProfileUpdate = {
  id?: string;
  tenant_id?: string;
  sku?: string;
  name?: string;
  tensile_stiffness?: number;
  bending_rigidity?: number;
  shear_stiffness?: number;
  area_density?: number;
  cad_pattern_url?: string | null;
  created_at?: string;
};

export type BiometricMeshRow = {
  id: string;
  tenant_id: string;
  session_id: string;
  mesh_object_path: string;
  source_image_object_path: string | null;
  is_processed: boolean;
  processed_at: string | null;
  expires_at: string;
  created_at: string;
};

export type BiometricMeshInsert = {
  id?: string;
  tenant_id: string;
  session_id: string;
  mesh_object_path: string;
  source_image_object_path?: string | null;
  is_processed?: boolean;
  processed_at?: string | null;
  expires_at: string;
  created_at?: string;
};

export type BiometricMeshUpdate = {
  id?: string;
  tenant_id?: string;
  session_id?: string;
  mesh_object_path?: string;
  source_image_object_path?: string | null;
  is_processed?: boolean;
  processed_at?: string | null;
  expires_at?: string;
  created_at?: string;
};

export type TenantIntegrationRow = {
  id: string;
  tenant_id: string;
  provider: 'replicate' | 'telemetry';
  replicate_api_key_ciphertext: string | null;
  telemetry_webhook_secret_ciphertext: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type TenantIntegrationInsert = {
  id?: string;
  tenant_id: string;
  provider: 'replicate' | 'telemetry';
  replicate_api_key_ciphertext?: string | null;
  telemetry_webhook_secret_ciphertext?: string | null;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type TenantIntegrationUpdate = {
  id?: string;
  tenant_id?: string;
  provider?: 'replicate' | 'telemetry';
  replicate_api_key_ciphertext?: string | null;
  telemetry_webhook_secret_ciphertext?: string | null;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type TenantUsageMeterRow = {
  tenant_id: string;
  billing_period_start: string;
  fit_sessions_count: number;
  created_at: string;
  updated_at: string;
};

export type TenantUsageMeterInsert = {
  tenant_id: string;
  billing_period_start: string;
  fit_sessions_count?: number;
  created_at?: string;
  updated_at?: string;
};

export type TenantUsageMeterUpdate = {
  tenant_id?: string;
  billing_period_start?: string;
  fit_sessions_count?: number;
  created_at?: string;
  updated_at?: string;
};

export type FitJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type FitJobRow = {
  id: string;
  tenant_id: string;
  status: FitJobStatus;
  replicate_prediction_id: string | null;
  input_image_url: string | null;
  smplx_params: Json | null;
  gltf_output_url: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type FitJobInsert = {
  id?: string;
  tenant_id: string;
  status?: FitJobStatus;
  replicate_prediction_id?: string | null;
  input_image_url?: string | null;
  smplx_params?: Json | null;
  gltf_output_url?: string | null;
  error_message?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type FitJobUpdate = {
  id?: string;
  tenant_id?: string;
  status?: FitJobStatus;
  replicate_prediction_id?: string | null;
  input_image_url?: string | null;
  smplx_params?: Json | null;
  gltf_output_url?: string | null;
  error_message?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type StoreTelemetryRow = {
  id: string;
  tenant_id: string;
  order_id: string;
  sku: string;
  vfr_used: boolean;
  returned: boolean;
  return_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type StoreTelemetryInsert = {
  id?: string;
  tenant_id: string;
  order_id: string;
  sku: string;
  vfr_used?: boolean;
  returned?: boolean;
  return_reason?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type StoreTelemetryUpdate = {
  id?: string;
  tenant_id?: string;
  order_id?: string;
  sku?: string;
  vfr_used?: boolean;
  returned?: boolean;
  return_reason?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type AuditLogEventType = 'UNAUTHORIZED_DOMAIN_ACCESS' | 'RATE_LIMIT_EXCEEDED';

export type AuditLogRow = {
  id: string;
  tenant_id: string;
  event_type: AuditLogEventType;
  ip_address: string | null;
  user_agent: string | null;
  payload: Json;
  created_at: string;
};

export type AuditLogInsert = {
  id?: string;
  tenant_id: string;
  event_type: AuditLogEventType;
  ip_address?: string | null;
  user_agent?: string | null;
  payload?: Json;
  created_at?: string;
};

export type AuditLogUpdate = {
  id?: string;
  tenant_id?: string;
  event_type?: AuditLogEventType;
  ip_address?: string | null;
  user_agent?: string | null;
  payload?: Json;
  created_at?: string;
};

export interface Database {
  public: {
    Tables: {
      merchants: {
        Row: MerchantRow;
        Insert: MerchantInsert;
        Update: MerchantUpdate;
        Relationships: [];
      };
      tenants: {
        Row: TenantRow;
        Insert: TenantInsert;
        Update: TenantUpdate;
        Relationships: [];
      };
      garment_cad_profiles: {
        Row: GarmentCadProfileRow;
        Insert: GarmentCadProfileInsert;
        Update: GarmentCadProfileUpdate;
        Relationships: [];
      };
      biometric_meshes: {
        Row: BiometricMeshRow;
        Insert: BiometricMeshInsert;
        Update: BiometricMeshUpdate;
        Relationships: [];
      };
      tenant_integrations: {
        Row: TenantIntegrationRow;
        Insert: TenantIntegrationInsert;
        Update: TenantIntegrationUpdate;
        Relationships: [];
      };
      tenant_usage_meters: {
        Row: TenantUsageMeterRow;
        Insert: TenantUsageMeterInsert;
        Update: TenantUsageMeterUpdate;
        Relationships: [];
      };
      fit_jobs: {
        Row: FitJobRow;
        Insert: FitJobInsert;
        Update: FitJobUpdate;
        Relationships: [];
      };
      store_telemetry: {
        Row: StoreTelemetryRow;
        Insert: StoreTelemetryInsert;
        Update: StoreTelemetryUpdate;
        Relationships: [];
      };
      audit_logs: {
        Row: AuditLogRow;
        Insert: AuditLogInsert;
        Update: AuditLogUpdate;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_current_tenant_id: {
        Args: Record<string, never>;
        Returns: string | null;
      };
      increment_fit_session_counter: {
        Args: {
          p_tenant_id: string;
        };
        Returns: {
          fit_sessions_count: number;
          monthly_quota: number;
          overage_allowed: boolean;
          plan_tier: string;
          quota_exceeded: boolean;
        }[];
      };
    };
  };
}
