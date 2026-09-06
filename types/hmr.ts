/**
 * Body estimation types for the VFR platform.
 * Zero usage of 'any' in compliance with AGENTS.md guardrails.
 *
 * New fit_jobs rows stamp Meta MHR topology `mhr-18439-127`.
 * `AnnyParametricVector` is legacy — do not write it on new rows.
 */

/** Official MHR LOD 1 render topology (Apache 2.0 assets). */
export const MHR_VERTEX_COUNT = 18439;
export const MHR_JOINT_COUNT = 127;
export const MHR_TOPOLOGY_VERSION = 'mhr-18439-127';
export const MHR_HULL_GLB_PUBLIC_PATH = '/models/mhr-hull.glb';
export const MHR_IDENTITY_DIM = 45;
export const MHR_BODY_IDENTITY_DIM = 20;
export const MHR_SKELETON_DIM = 68;
export const MHR_MODEL_PARAM_DIM = 204;

/** Shipped default ANNY hull: triangulated `anny` topology + compact `anny` rig. */
export const ANNY_VERTEX_COUNT = 13380;
export const ANNY_JOINT_COUNT = 104;
export const ANNY_TOPOLOGY_VERSION = 'anny-13380-104';
export const ANNY_HULL_GLB_PUBLIC_PATH = '/models/anny-hull.glb';
export const ANNY_PHENOTYPE_DIM = 6;

/** Default ANNY morphological phenotypes, excluding cupsize / firmness / race. */
export const ANNY_PHENOTYPE_LABELS = [
  'gender',
  'age',
  'muscle',
  'weight',
  'height',
  'proportions',
] as const;

export type AnnyPhenotypeLabel = (typeof ANNY_PHENOTYPE_LABELS)[number];
export type AnnyPhenotype = [number, number, number, number, number, number];

/** ISO 8559-1 plane-slice girths. Shared by MHR and legacy ANNY rows. */
export interface BodyGirthMeasurements {
  chest_cm: number;
  waist_cm: number;
  hip_cm: number;
}

export type AnnyDerivedMeasurements = BodyGirthMeasurements;
export type MhrDerivedMeasurements = BodyGirthMeasurements;

/**
 * Product body representation from a live ANNY-Fit call.
 * Joint rotations stay a flat number array so shader-texture, PCA-subset, or
 * one-shot deform outputs can be stored without assuming a morph-target count.
 */
export interface AnnyParametricVector {
  phenotype: AnnyPhenotype;
  joint_rotations: number[];
  derived_measurements: AnnyDerivedMeasurements;
  topology_version: typeof ANNY_TOPOLOGY_VERSION | string;
  stated_weight_kg?: number;
}

/**
 * Product body representation from a live Cog `task=body` call.
 * Identity is 45 PCA coeffs (first 20 = shared body). Skeleton is the 68
 * scale parameters. Pose is the 204 MHR model_parameters used to evaluate
 * the canonical mesh. Prefer `vertex_positions` from the Cog (LOD 1 cm).
 */
export interface MhrParametricVector {
  shape: number[];
  skeleton: number[];
  pose: number[];
  joint_rotations: number[];
  derived_measurements: MhrDerivedMeasurements;
  topology_version: typeof MHR_TOPOLOGY_VERSION;
  stated_weight_kg?: number;
  vertex_positions?: number[];
  vertex_storage_url?: string;
  height_residual_cm?: number;
  clothing_residual?: number;
}

export type FitParametricVector = MhrParametricVector | AnnyParametricVector;

export type CaptureSex = 'female' | 'male' | 'unspecified';
export type CaptureView = 'front' | 'side';
export type PoseGateStatus =
  | 'aligned'
  | 'too_close'
  | 'too_far'
  | 'turn_required'
  | 'raise_wrists'
  | 'not_detected';

export interface CaptureSession {
  tenantId: string;
  fitJobId: string | null;
  heightCm: number;
  sex: CaptureSex;
  weightKg: number | null;
  frontImagePath: string | null;
  sideImagePath: string | null;
  frontGate: PoseGateStatus | null;
  sideGate: PoseGateStatus | null;
  captureGatesPassed: boolean;
}

export type FitJobPublicStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface FitJobStatusPayload {
  id: string;
  status: FitJobPublicStatus;
  parametric_result: FitParametricVector | null;
  error_message: string | null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readAnnyParametricVector(value: unknown): AnnyParametricVector | null {
  if (!isRecord(value)) {
    return null;
  }

  const phenotype = value.phenotype;
  if (
    !Array.isArray(phenotype)
    || phenotype.length !== ANNY_PHENOTYPE_DIM
    || !phenotype.every(isFiniteNumber)
  ) {
    return null;
  }

  const jointRotations = value.joint_rotations;
  if (
    !Array.isArray(jointRotations)
    || jointRotations.length === 0
    || !jointRotations.every(isFiniteNumber)
  ) {
    return null;
  }

  const measurements = value.derived_measurements;
  if (!isRecord(measurements)) {
    return null;
  }

  if (
    !isFiniteNumber(measurements.chest_cm)
    || !isFiniteNumber(measurements.waist_cm)
    || !isFiniteNumber(measurements.hip_cm)
    || typeof value.topology_version !== 'string'
    || value.topology_version.length === 0
    || value.topology_version === MHR_TOPOLOGY_VERSION
  ) {
    return null;
  }

  const result: AnnyParametricVector = {
    phenotype: [
      phenotype[0],
      phenotype[1],
      phenotype[2],
      phenotype[3],
      phenotype[4],
      phenotype[5],
    ],
    joint_rotations: jointRotations.slice(),
    derived_measurements: {
      chest_cm: measurements.chest_cm,
      waist_cm: measurements.waist_cm,
      hip_cm: measurements.hip_cm,
    },
    topology_version: value.topology_version,
  };

  if (isFiniteNumber(value.stated_weight_kg)) {
    result.stated_weight_kg = value.stated_weight_kg;
  }

  return result;
}

function readFiniteNumbers(value: unknown, minimumLength: number): number[] | null {
  if (!Array.isArray(value) || value.length < minimumLength || !value.every(isFiniteNumber)) {
    return null;
  }

  return value.slice();
}

function readGirths(value: unknown): MhrDerivedMeasurements | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    !isFiniteNumber(value.chest_cm)
    || !isFiniteNumber(value.waist_cm)
    || !isFiniteNumber(value.hip_cm)
    || value.chest_cm <= 0
    || value.waist_cm <= 0
    || value.hip_cm <= 0
  ) {
    return null;
  }

  return {
    chest_cm: value.chest_cm,
    waist_cm: value.waist_cm,
    hip_cm: value.hip_cm,
  };
}

export function readMhrParametricVector(value: unknown): MhrParametricVector | null {
  if (!isRecord(value) || value.topology_version !== MHR_TOPOLOGY_VERSION) {
    return null;
  }

  const shape = readFiniteNumbers(value.shape, MHR_BODY_IDENTITY_DIM);
  const skeleton = readFiniteNumbers(value.skeleton, MHR_SKELETON_DIM);
  const pose = readFiniteNumbers(value.pose, MHR_MODEL_PARAM_DIM);
  const measurements = readGirths(value.derived_measurements);
  if (!shape || !skeleton || !pose || !measurements) {
    return null;
  }

  if (shape.length !== MHR_BODY_IDENTITY_DIM && shape.length !== MHR_IDENTITY_DIM) {
    return null;
  }

  if (skeleton.length !== MHR_SKELETON_DIM || pose.length !== MHR_MODEL_PARAM_DIM) {
    return null;
  }

  const jointRotations = readFiniteNumbers(value.joint_rotations, 1) ?? pose.slice();
  const result: MhrParametricVector = {
    shape,
    skeleton,
    pose,
    joint_rotations: jointRotations,
    derived_measurements: measurements,
    topology_version: MHR_TOPOLOGY_VERSION,
  };

  if (isFiniteNumber(value.stated_weight_kg)) {
    result.stated_weight_kg = value.stated_weight_kg;
  }

  const vertices = value.vertex_positions;
  if (Array.isArray(vertices)) {
    if (vertices.length !== MHR_VERTEX_COUNT * 3 || !vertices.every(isFiniteNumber)) {
      return null;
    }

    result.vertex_positions = vertices.slice();
  }

  if (typeof value.vertex_storage_url === 'string' && value.vertex_storage_url.length > 0) {
    result.vertex_storage_url = value.vertex_storage_url;
  }

  if (isFiniteNumber(value.height_residual_cm)) {
    result.height_residual_cm = value.height_residual_cm;
  }

  if (isFiniteNumber(value.clothing_residual)) {
    result.clothing_residual = value.clothing_residual;
  }

  return result;
}

export function isMhrParametricVector(value: unknown): value is MhrParametricVector {
  return readMhrParametricVector(value) !== null;
}

export function isAnnyParametricVector(value: unknown): value is AnnyParametricVector {
  return readAnnyParametricVector(value) !== null;
}

export function readFitParametricVector(value: unknown): FitParametricVector | null {
  return readMhrParametricVector(value) ?? readAnnyParametricVector(value);
}
