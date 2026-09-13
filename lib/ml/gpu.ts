import { createHmac } from 'node:crypto';

import { readShopperGpuMaxInstances } from '@/lib/ml/session-gpu';
import {
  ANNY_PHENOTYPE_DIM,
  ANNY_PHENOTYPE_LABELS,
  ANNY_TOPOLOGY_VERSION,
  MHR_BODY_IDENTITY_DIM,
  MHR_IDENTITY_DIM,
  MHR_MODEL_PARAM_DIM,
  MHR_SKELETON_DIM,
  MHR_TOPOLOGY_VERSION,
  MHR_VERTEX_COUNT,
  readMhrFitDiagnostics,
  type AnnyDerivedMeasurements,
  type AnnyParametricVector,
  type AnnyPhenotype,
  type CaptureSex,
  type MhrParametricVector,
} from '@/types/hmr';
import { readRestLengthMesh, type GarmentCategory, type RestLengthMesh } from '@/types/garment';
import type { SimDrapeMesh } from '@/types/graphics';

export interface RunBodyInput {
  frontImageB64: string;
  sideImageB64: string;
  heightCm: number;
  sex: CaptureSex;
  weightKg?: number;
}

export interface RunDrapeInput {
  colliderPositions: number[];
  colliderIndices: number[];
  garmentRestMesh: RestLengthMesh;
  tensileStiffness: number;
  bendingRigidity: number;
  shearStiffness: number;
  areaDensity: number;
  originY: number;
}

export interface RunPatternSizeInput {
  sizeCode: string;
  chestCm: number;
  waistCm: number;
  hipCm: number;
  lengthCm: number;
}

export interface RunPatternInput {
  category: GarmentCategory;
  productText: string;
  sizeVariants: RunPatternSizeInput[];
}

export type PatternIngestStatus =
  | 'ok'
  | 'unsupported'
  | 'self_intersecting'
  | 'chart_mismatch'
  | 'instantiate_failed';

export interface PatternIngestResult {
  status: PatternIngestStatus;
  unsupportedReason: string | null;
  meshes: RestLengthMesh[];
}

export interface GpuPredictionSnapshot {
  id: string;
  status: string;
  output: unknown;
  error: string | null;
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ModalHardwarePin {
  sku: string;
  pinMode: 'modal';
  deployment: string;
}

export interface ModalRuntimeConfig {
  urlConfigured: boolean;
  hmacConfigured: boolean;
  gpuUrl: string | null;
  hardware: ModalHardwarePin;
  operatorMessage: string | null;
}

export interface SessionGpuResult {
  action: 'warm' | 'sleep' | 'status';
  hardware: ModalHardwarePin;
  minContainers: number | null;
  maxContainers: number | null;
  minContainersUpdated: boolean;
}

/** Official Modal SKU for Nvidia A100 80GB. */
export const MODAL_A100_80GB_SKU = 'A100-80GB';
export const MODAL_APP_NAME = 'ashrium-vfr-gpu';
export const GPU_CALL_ID_PREFIX = 'modal_';

export function describeMissingModalGpuUrl(): string {
  return [
    'MODAL_GPU_URL is required for live inference.',
    'Deploy gpu/modal_app.py and set MODAL_GPU_URL to the HTTPS Modal web endpoint.',
    'There is no mock fallback.',
  ].join(' ');
}

export function describeMissingGpuHmac(): string {
  return [
    'ASHRIUM_GPU_HMAC is required (at least 16 characters).',
    'Create the matching Modal secret and set the same value in .env.local / Vercel.',
    'There is no mock fallback.',
  ].join(' ');
}

export function getModalGpuUrl(): string {
  const configured = process.env.MODAL_GPU_URL?.trim().replace(/\/$/, '') ?? '';
  if (!configured) {
    throw new Error(describeMissingModalGpuUrl());
  }
  if (!configured.startsWith('https://')) {
    throw new Error('MODAL_GPU_URL must use HTTPS.');
  }
  return configured;
}

export function getGpuHmacSecret(): string {
  const secret = process.env.ASHRIUM_GPU_HMAC?.trim() ?? '';
  if (secret.length < 16) {
    throw new Error(describeMissingGpuHmac());
  }
  return secret;
}

export function inspectModalRuntimeConfig(): ModalRuntimeConfig {
  const rawUrl = process.env.MODAL_GPU_URL?.trim().replace(/\/$/, '') ?? '';
  const hmac = process.env.ASHRIUM_GPU_HMAC?.trim() ?? '';
  const urlConfigured = rawUrl.startsWith('https://');
  const hmacConfigured = hmac.length >= 16;
  const hardware: ModalHardwarePin = {
    sku: MODAL_A100_80GB_SKU,
    pinMode: 'modal',
    deployment: MODAL_APP_NAME,
  };
  const operatorMessage = !urlConfigured
    ? describeMissingModalGpuUrl()
    : !hmacConfigured
      ? describeMissingGpuHmac()
      : null;

  return {
    urlConfigured,
    hmacConfigured,
    gpuUrl: urlConfigured ? rawUrl : null,
    hardware,
    operatorMessage,
  };
}

export function modalCallIdForJob(jobId: string): string {
  return `${GPU_CALL_ID_PREFIX}${jobId}`;
}

export function isModalCallId(predictionId: string | null | undefined): boolean {
  return typeof predictionId === 'string' && predictionId.startsWith(GPU_CALL_ID_PREFIX);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 10) {
    return null;
  }

  return Number.isFinite(Date.parse(value)) ? value : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function flattenNumberArray(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const flattened: number[] = [];
  const stack: unknown[] = [...value];

  while (stack.length > 0) {
    const entry = stack.shift();
    if (Array.isArray(entry)) {
      stack.unshift(...entry);
      continue;
    }

    if (!isFiniteNumber(entry)) {
      return null;
    }

    flattened.push(entry);
  }

  return flattened.length > 0 ? flattened : null;
}

function readFirstPresent(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }

  return undefined;
}

function parsePhenotype(value: unknown): AnnyPhenotype {
  const fromArray = flattenNumberArray(value);
  if (fromArray && fromArray.length === ANNY_PHENOTYPE_DIM) {
    return fromArray as AnnyPhenotype;
  }

  if (!isRecord(value)) {
    throw new Error(`ANNY-Fit phenotype must contain ${ANNY_PHENOTYPE_DIM} values`);
  }

  const assembled = ANNY_PHENOTYPE_LABELS.map((label) => {
    const entry = value[label];
    if (!isFiniteNumber(entry)) {
      throw new Error(`ANNY-Fit phenotype.${label} must be a finite number`);
    }

    return entry;
  });

  return assembled as AnnyPhenotype;
}

function parseDerivedMeasurements(value: unknown): AnnyDerivedMeasurements {
  if (!isRecord(value)) {
    throw new Error('derived_measurements must be an object');
  }

  const chest = readFirstPresent(value, ['chest_cm', 'chest', 'bust_cm', 'bust']);
  const waist = readFirstPresent(value, ['waist_cm', 'waist']);
  const hip = readFirstPresent(value, ['hip_cm', 'hip', 'hips_cm', 'hips']);

  if (!isFiniteNumber(chest) || chest <= 0) {
    throw new Error('derived_measurements.chest_cm must be a positive number');
  }

  if (!isFiniteNumber(waist) || waist <= 0) {
    throw new Error('derived_measurements.waist_cm must be a positive number');
  }

  if (!isFiniteNumber(hip) || hip <= 0) {
    throw new Error('derived_measurements.hip_cm must be a positive number');
  }

  return {
    chest_cm: chest,
    waist_cm: waist,
    hip_cm: hip,
  };
}

function parseTopologyVersion(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return ANNY_TOPOLOGY_VERSION;
  }

  if (typeof value !== 'string') {
    throw new Error('ANNY-Fit topology_version must be a string');
  }

  if (value !== ANNY_TOPOLOGY_VERSION) {
    throw new Error(
      `ANNY-Fit topology_version ${value} does not match shipped hull ${ANNY_TOPOLOGY_VERSION}`,
    );
  }

  return ANNY_TOPOLOGY_VERSION;
}

function unwrapPredictionOutput(output: unknown): unknown {
  if (Array.isArray(output) && output.length === 1) {
    return output[0];
  }

  return output;
}

export function parseAnnyParametricVector(
  output: unknown,
  statedWeightKg?: number,
): AnnyParametricVector {
  const unwrapped = unwrapPredictionOutput(output);
  if (!isRecord(unwrapped)) {
    throw new Error('ANNY-Fit output must be an object');
  }

  const phenotype = parsePhenotype(
    readFirstPresent(unwrapped, ['phenotype', 'P', 'p', 'shape']),
  );
  const jointRotations = flattenNumberArray(
    readFirstPresent(unwrapped, ['joint_rotations', 'pose', 'joints', 'joint_rots']),
  );

  if (!jointRotations) {
    throw new Error('ANNY-Fit joint_rotations must be a non-empty number array');
  }

  const derivedMeasurements = parseDerivedMeasurements(
    readFirstPresent(unwrapped, ['derived_measurements', 'measurements', 'girths']),
  );
  const statedWeight = isFiniteNumber(unwrapped.stated_weight_kg)
    ? unwrapped.stated_weight_kg
    : statedWeightKg;

  const result: AnnyParametricVector = {
    phenotype,
    joint_rotations: jointRotations,
    derived_measurements: derivedMeasurements,
    topology_version: parseTopologyVersion(unwrapped.topology_version),
  };

  if (statedWeight !== undefined) {
    result.stated_weight_kg = statedWeight;
  }

  return result;
}

function requireNumberVector(value: unknown, expectedLength: number, label: string): number[] {
  const flattened = flattenNumberArray(value);
  if (!flattened || flattened.length !== expectedLength) {
    throw new Error(`${label} must contain ${expectedLength} finite numbers`);
  }

  return flattened;
}

function requireMinNumberVector(value: unknown, minimumLength: number, label: string): number[] {
  const flattened = flattenNumberArray(value);
  if (!flattened || flattened.length < minimumLength) {
    throw new Error(`${label} must contain at least ${minimumLength} finite numbers`);
  }

  return flattened;
}

export function parseMhrParametricVector(
  output: unknown,
  statedWeightKg?: number,
): MhrParametricVector {
  const unwrapped = unwrapPredictionOutput(output);
  if (!isRecord(unwrapped)) {
    throw new Error('MHR Cog output must be an object');
  }

  if (unwrapped.topology_version !== MHR_TOPOLOGY_VERSION) {
    throw new Error(
      `MHR topology_version must be ${MHR_TOPOLOGY_VERSION}; got ${String(unwrapped.topology_version)}`,
    );
  }

  const shape = requireMinNumberVector(
    readFirstPresent(unwrapped, ['shape', 'identity', 'identity_coeffs']),
    MHR_BODY_IDENTITY_DIM,
    'MHR shape',
  );
  if (shape.length !== MHR_BODY_IDENTITY_DIM && shape.length !== MHR_IDENTITY_DIM) {
    throw new Error(`MHR shape must have ${MHR_BODY_IDENTITY_DIM} or ${MHR_IDENTITY_DIM} values`);
  }

  const skeleton = requireNumberVector(
    readFirstPresent(unwrapped, ['skeleton', 'scale', 'scale_params']),
    MHR_SKELETON_DIM,
    'MHR skeleton',
  );
  const pose = requireNumberVector(
    readFirstPresent(unwrapped, ['pose', 'model_parameters', 'mhr_model_params']),
    MHR_MODEL_PARAM_DIM,
    'MHR pose',
  );
  const jointRotations = flattenNumberArray(
    readFirstPresent(unwrapped, ['joint_rotations', 'joints', 'joint_rots']),
  ) ?? pose;
  const derivedMeasurements = parseDerivedMeasurements(
    readFirstPresent(unwrapped, ['derived_measurements', 'measurements', 'girths']),
  );
  const statedWeight = isFiniteNumber(unwrapped.stated_weight_kg)
    ? unwrapped.stated_weight_kg
    : statedWeightKg;

  const result: MhrParametricVector = {
    shape,
    skeleton,
    pose,
    joint_rotations: jointRotations,
    derived_measurements: derivedMeasurements,
    topology_version: MHR_TOPOLOGY_VERSION,
  };

  if (statedWeight !== undefined) {
    result.stated_weight_kg = statedWeight;
  }

  const vertices = flattenNumberArray(
    readFirstPresent(unwrapped, ['vertex_positions', 'vertices', 'vertex_buffer']),
  );
  if (!vertices || vertices.length !== MHR_VERTEX_COUNT * 3) {
    throw new Error(
      `MHR vertex_positions must contain ${MHR_VERTEX_COUNT * 3} values (LOD 1 xyz)`,
    );
  }

  result.vertex_positions = vertices;

  if (typeof unwrapped.vertex_storage_url === 'string' && unwrapped.vertex_storage_url.length > 0) {
    result.vertex_storage_url = unwrapped.vertex_storage_url;
  }

  if (isFiniteNumber(unwrapped.height_residual_cm)) {
    result.height_residual_cm = unwrapped.height_residual_cm;
  }

  if (isFiniteNumber(unwrapped.clothing_residual)) {
    result.clothing_residual = unwrapped.clothing_residual;
  }

  const diagnostics = readMhrFitDiagnostics(unwrapped.fit_diagnostics);
  if (diagnostics) {
    result.fit_diagnostics = diagnostics;
  }

  return result;
}

function requireJsonNumberArray(value: unknown, label: string, expectedLength?: number): number[] {
  const flattened = flattenNumberArray(value);
  if (!flattened) {
    throw new Error(`${label} must be a finite number array`);
  }
  if (expectedLength !== undefined && flattened.length !== expectedLength) {
    throw new Error(`${label} must contain ${expectedLength} finite numbers`);
  }
  return flattened;
}

export function parseDrapeSimOutput(output: unknown): SimDrapeMesh {
  const unwrapped = unwrapPredictionOutput(output);
  if (!isRecord(unwrapped)) {
    throw new Error('Drape Cog output must be an object');
  }

  if (unwrapped.topology_version !== MHR_TOPOLOGY_VERSION) {
    throw new Error(
      `Drape topology_version must be ${MHR_TOPOLOGY_VERSION}; got ${String(unwrapped.topology_version)}`,
    );
  }

  const vertexCountValue = unwrapped.vertex_count;
  if (!isFiniteNumber(vertexCountValue) || vertexCountValue <= 0) {
    throw new Error('Drape vertex_count must be a positive number');
  }
  const vertexCount = Math.trunc(vertexCountValue);
  const restPositions = new Float32Array(
    requireJsonNumberArray(unwrapped.rest_positions, 'rest_positions', vertexCount * 3),
  );
  const delta = new Float32Array(requireJsonNumberArray(unwrapped.delta, 'delta', vertexCount * 3));
  const strain = new Float32Array(requireJsonNumberArray(unwrapped.strain, 'strain', vertexCount));
  const clearanceCm = new Float32Array(
    requireJsonNumberArray(unwrapped.clearance_cm, 'clearance_cm', vertexCount),
  );
  const indexValues = requireJsonNumberArray(unwrapped.indices, 'indices');
  if (indexValues.length < 3 || indexValues.length % 3 !== 0) {
    throw new Error('Drape indices must be triangle faces');
  }

  const meanStrain = isFiniteNumber(unwrapped.mean_strain) ? unwrapped.mean_strain : 0;

  return {
    restPositions,
    delta,
    strain,
    clearanceCm,
    indices: Uint32Array.from(indexValues, (value) => Math.trunc(value)),
    vertexCount,
    topologyVersion: MHR_TOPOLOGY_VERSION,
    meanStrain,
  };
}

const PATTERN_INGEST_STATUSES: readonly PatternIngestStatus[] = [
  'ok',
  'unsupported',
  'self_intersecting',
  'chart_mismatch',
  'instantiate_failed',
];

export function parsePatternPredictionOutput(output: unknown): PatternIngestResult {
  const unwrapped = unwrapPredictionOutput(output);
  if (!isRecord(unwrapped)) {
    throw new Error('Pattern Cog output must be an object');
  }

  const statusRaw = unwrapped.status;
  if (typeof statusRaw === 'string' && PATTERN_INGEST_STATUSES.includes(statusRaw as PatternIngestStatus)) {
    const status = statusRaw as PatternIngestStatus;
    const reason =
      typeof unwrapped.unsupported_reason === 'string' && unwrapped.unsupported_reason.trim().length > 0
        ? unwrapped.unsupported_reason.trim()
        : null;

    if (status !== 'ok') {
      return { status, unsupportedReason: reason, meshes: [] };
    }

    if (!Array.isArray(unwrapped.meshes) || unwrapped.meshes.length === 0) {
      throw new Error('Pattern Cog status=ok requires a non-empty meshes array.');
    }

    const meshes: RestLengthMesh[] = [];
    for (const entry of unwrapped.meshes) {
      const mesh = readRestLengthMesh(entry);
      if (!mesh) {
        throw new Error('Pattern Cog mesh is not a valid ashrium.rest_length.v1 panel.');
      }
      meshes.push(mesh);
    }

    return { status: 'ok', unsupportedReason: null, meshes };
  }

  if (isPatternCogBodyOutput(unwrapped)) {
    throw new Error(describePatternCogMismatch());
  }

  throw new Error('Pattern Cog output.status is missing or invalid.');
}

export function describePatternCogMismatch(): string {
  return [
    'The live Modal GPU app does not support task=pattern (GarmentCode ingest).',
    'A task=pattern request was treated as task=body and required front_image/side_image.',
    'Deploy the current gpu/ tree with modal deploy gpu/modal_app.py.',
    'There is no mock, Laplacian, or fixture fallback.',
  ].join(' ');
}

export function isPatternCogBodyImageMismatch(errorText: string): boolean {
  const text = errorText.toLowerCase();
  const mentionsFront = text.includes('front_image');
  const mentionsSide = text.includes('side_image');
  const mentionsRequired = text.includes('required') || text.includes('field required');
  const bodyTaskRequiresImages = text.includes('task=body') && (mentionsFront || mentionsSide);
  return bodyTaskRequiresImages || ((mentionsFront || mentionsSide) && mentionsRequired);
}

export function isPatternCogBodyOutput(output: unknown): boolean {
  const unwrapped = unwrapPredictionOutput(output);
  if (!isRecord(unwrapped)) {
    return false;
  }

  const topology = unwrapped.topology_version;
  if (topology === MHR_TOPOLOGY_VERSION || topology === ANNY_TOPOLOGY_VERSION) {
    return true;
  }

  return 'phenotype' in unwrapped || 'shape' in unwrapped || 'derived_measurements' in unwrapped;
}

export function rewritePatternCogError(error: unknown): Error {
  const text = error instanceof Error ? error.message : String(error);
  if (text === describePatternCogMismatch() || isPatternCogBodyImageMismatch(text)) {
    return new Error(describePatternCogMismatch());
  }

  return error instanceof Error ? error : new Error(text);
}


export function signGpuRequest(rawBody: string, timestamp: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
}

function gpuHeaders(rawBody: string): HeadersInit {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return {
    'Content-Type': 'application/json',
    'X-Ashrium-Timestamp': timestamp,
    'X-Ashrium-Signature': signGpuRequest(rawBody, timestamp, getGpuHmacSecret()),
  };
}

async function modalJson(pathName: string, payload: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
  const rawBody = JSON.stringify(payload);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${getModalGpuUrl()}${pathName}`, {
      method: 'POST',
      headers: gpuHeaders(rawBody),
      body: rawBody,
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Modal GPU ${pathName} timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Modal GPU ${pathName} failed (${response.status}): ${text || response.statusText}`);
  }

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Modal GPU ${pathName} returned non-JSON.`);
  }
}

function readOptionalInt(value: unknown): number | null {
  return isFiniteNumber(value) ? Math.trunc(value) : null;
}

export function isTerminalGpuStatus(status: string): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'canceled' || status === 'aborted';
}

export async function fetchGpuPrediction(predictionId: string): Promise<GpuPredictionSnapshot> {
  if (isModalCallId(predictionId)) {
    return {
      id: predictionId,
      status: 'starting',
      output: null,
      error: null,
      createdAt: null,
      startedAt: null,
      completedAt: null,
    };
  }

  throw new Error('Unknown GPU call id. Live inference is Modal only.');
}

export async function cancelGpuCall(predictionId: string): Promise<void> {
  if (!predictionId || isModalCallId(predictionId)) {
    return;
  }
}

export async function scaleModalGpu(minContainers: number): Promise<{
  minContainers: number;
  minContainersUpdated: boolean;
}> {
  const cap = readShopperGpuMaxInstances();
  const next = Math.min(cap, Math.max(0, Math.trunc(minContainers)));
  const payload = next <= 0
    ? { action: 'sleep', min_containers: 0 }
    : { action: 'warm', min_containers: next };
  const result = await modalJson('/session', payload, 60_000);
  const record = isRecord(result) ? result : {};
  return {
    minContainers: readOptionalInt(record.min_containers) ?? next,
    minContainersUpdated: true,
  };
}

export async function readModalSessionGpu(): Promise<SessionGpuResult> {
  inspectModalRuntimeConfig();
  getModalGpuUrl();
  getGpuHmacSecret();
  return {
    action: 'status',
    hardware: {
      sku: MODAL_A100_80GB_SKU,
      pinMode: 'modal',
      deployment: MODAL_APP_NAME,
    },
    minContainers: null,
    maxContainers: readShopperGpuMaxInstances(),
    minContainersUpdated: false,
  };
}

export async function setModalSessionGpu(action: 'warm' | 'sleep'): Promise<SessionGpuResult> {
  const scaled = await scaleModalGpu(action === 'sleep' ? 0 : 1);
  return {
    action,
    hardware: {
      sku: MODAL_A100_80GB_SKU,
      pinMode: 'modal',
      deployment: MODAL_APP_NAME,
    },
    minContainers: scaled.minContainers,
    maxContainers: readShopperGpuMaxInstances(),
    minContainersUpdated: scaled.minContainersUpdated,
  };
}

export async function runBodyPrediction(
  input: RunBodyInput,
  options?: { timeoutMs?: number },
): Promise<unknown> {
  if (!input.frontImageB64 || !input.sideImageB64) {
    throw new Error('task=body requires front and side WebP frames.');
  }

  return modalJson(
    '/body',
    {
      front_image_b64: input.frontImageB64,
      side_image_b64: input.sideImageB64,
      height_cm: input.heightCm,
      sex: input.sex,
      weight_kg: input.weightKg ?? 0,
    },
    options?.timeoutMs ?? 280_000,
  );
}

export async function runDrapePrediction(
  input: RunDrapeInput,
  options?: { timeoutMs?: number },
): Promise<SimDrapeMesh> {
  const output = await modalJson(
    '/drape',
    {
      collider_positions: JSON.stringify(input.colliderPositions),
      collider_indices: JSON.stringify(input.colliderIndices),
      garment_rest_mesh: JSON.stringify(input.garmentRestMesh),
      tensile_stiffness: input.tensileStiffness,
      bending_rigidity: input.bendingRigidity,
      shear_stiffness: input.shearStiffness,
      area_density: input.areaDensity,
      origin_y: input.originY,
    },
    options?.timeoutMs ?? 120_000,
  );
  return parseDrapeSimOutput(output);
}

export async function runPatternPrediction(input: RunPatternInput): Promise<PatternIngestResult> {
  if (input.sizeVariants.length === 0) {
    throw new Error('task=pattern requires at least one size with published girths.');
  }

  const output = await modalJson(
    '/pattern',
    {
      product_text: input.productText,
      size_chart: JSON.stringify(input.sizeVariants),
      garment_category: input.category,
    },
    180_000,
  );
  return parsePatternPredictionOutput(output);
}
