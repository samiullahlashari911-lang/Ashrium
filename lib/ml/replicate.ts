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
  type AnnyDerivedMeasurements,
  type AnnyParametricVector,
  type AnnyPhenotype,
  type CaptureSex,
  type MhrParametricVector,
} from '@/types/hmr';

export interface RunAnnyFitInput {
  frontImageUrl: string;
  sideImageUrl: string;
  heightCm: number;
  sex: CaptureSex;
  weightKg?: number;
}

export interface DispatchAnnyFitPredictionInput extends RunAnnyFitInput {
  webhookUrl: string;
}

export interface ReplicatePredictionReceipt {
  id: string;
  status: string;
}

export interface AnnyFitModelVersionRef {
  configured: string;
  versionId: string;
  owner: string | null;
  name: string | null;
}

export interface AnnyFitCogVersionConfirmation extends AnnyFitModelVersionRef {
  cogVersion: string | null;
}

export interface ReplicateDeploymentRef {
  configured: string;
  owner: string;
  name: string;
}

export interface ReplicateHardwarePin {
  sku: string;
  pinMode: 'deployment' | 'model_dashboard';
  deployment: string | null;
}

export interface ReplicateRuntimeConfig {
  tokenConfigured: boolean;
  modelVersionConfigured: boolean;
  deploymentConfigured: boolean;
  modelVersion: string | null;
  hardware: ReplicateHardwarePin;
  operatorMessage: string | null;
}

export interface ReplicateDeploymentStatus {
  owner: string;
  name: string;
  hardware: string | null;
  minInstances: number | null;
  maxInstances: number | null;
  model: string | null;
  version: string | null;
}

export interface SessionGpuResult {
  action: 'warm' | 'sleep' | 'status';
  confirmation: AnnyFitCogVersionConfirmation;
  hardware: ReplicateHardwarePin;
  deployment: ReplicateDeploymentStatus;
  hardwareUpdated: boolean;
  minInstancesUpdated: boolean;
  versionMatchesDeployment: boolean;
}

interface ReplicatePredictionResponse {
  id: string;
  status: string;
  output: unknown;
  error: string | null;
}

const ANNY_FIT_VERSION_ID_PATTERN = /^[0-9a-f]{64}$/i;
const ANNY_FIT_NAMED_VERSION_PATTERN =
  /^([a-z0-9](?:[a-z0-9_-]{0,38}[a-z0-9])?)\/([a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?):([0-9a-f]{64})$/i;
const REPLICATE_DEPLOYMENT_PATTERN =
  /^([a-z0-9](?:[a-z0-9_-]{0,38}[a-z0-9])?)\/([a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?)$/i;
const REPLICATE_HARDWARE_SKU_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Official Replicate SKU for Nvidia A100 80GB. Predictions cannot set this field. */
export const REPLICATE_A100_80GB_SKU = 'gpu-a100-large';

export function describeMissingReplicateToken(): string {
  return [
    'REPLICATE_API_TOKEN is required for live inference.',
    'Add it to .env.local as REPLICATE_API_TOKEN.',
    'There is no mock fallback.',
  ].join(' ');
}

export function describeMissingReplicateModelVersion(): string {
  return [
    'Missing environment variable: REPLICATE_HMR_MODEL_VERSION.',
    'Set it in .env.local to the pushed Cog version: a 64-character hash, or owner/name:<hash>.',
    'Create a private Replicate model, cog push the tree in cog/, then pin that version on a Deployment.',
  ].join(' ');
}

export function describeMissingReplicateDeployment(): string {
  return [
    'Missing environment variable: REPLICATE_DEPLOYMENT.',
    'Create a Replicate Deployment on gpu-a100-large for the pushed Cog and set REPLICATE_DEPLOYMENT=owner/name.',
    'Shopper inference and session Warm/Sleep use the Deployments API. There is no mock fallback.',
  ].join(' ');
}

function getReplicateApiToken(): string {
  const token = process.env.REPLICATE_API_TOKEN?.trim();
  if (!token) {
    throw new Error(describeMissingReplicateToken());
  }

  return token;
}

export function parseReplicateHardwareSku(configured: string): string {
  const sku = configured.trim();
  if (!REPLICATE_HARDWARE_SKU_PATTERN.test(sku)) {
    throw new Error(
      'REPLICATE_HARDWARE must be a Replicate hardware SKU such as gpu-a100-large (Nvidia A100 80GB).',
    );
  }

  return sku;
}

export function getReplicateHardwareSku(): string {
  const configured = process.env.REPLICATE_HARDWARE?.trim();
  if (!configured) {
    return REPLICATE_A100_80GB_SKU;
  }

  return parseReplicateHardwareSku(configured);
}

export function parseReplicateDeploymentRef(configured: string): ReplicateDeploymentRef {
  const namedMatch = configured.trim().match(REPLICATE_DEPLOYMENT_PATTERN);
  if (!namedMatch || !namedMatch[1] || !namedMatch[2]) {
    throw new Error('REPLICATE_DEPLOYMENT must be owner/name of a Replicate deployment.');
  }

  return {
    configured: configured.trim(),
    owner: namedMatch[1],
    name: namedMatch[2],
  };
}

export function getReplicateDeploymentRef(): ReplicateDeploymentRef | null {
  const configured = process.env.REPLICATE_DEPLOYMENT?.trim();
  if (!configured) {
    return null;
  }

  return parseReplicateDeploymentRef(configured);
}

export function requireReplicateDeploymentRef(): ReplicateDeploymentRef {
  const deployment = getReplicateDeploymentRef();
  if (!deployment) {
    throw new Error(describeMissingReplicateDeployment());
  }

  return deployment;
}

export function getReplicateHardwarePin(): ReplicateHardwarePin {
  const deployment = getReplicateDeploymentRef();
  return {
    sku: getReplicateHardwareSku(),
    pinMode: deployment ? 'deployment' : 'model_dashboard',
    deployment: deployment?.configured ?? null,
  };
}

export function inspectReplicateRuntimeConfig(): ReplicateRuntimeConfig {
  const tokenConfigured = Boolean(process.env.REPLICATE_API_TOKEN?.trim());
  const rawVersion = process.env.REPLICATE_HMR_MODEL_VERSION?.trim() ?? '';
  let modelVersion: string | null = null;
  let versionError: string | null = null;

  if (rawVersion) {
    try {
      parseAnnyFitModelVersionRef(rawVersion);
      modelVersion = rawVersion;
    } catch (error) {
      versionError = error instanceof Error ? error.message : describeMissingReplicateModelVersion();
    }
  }

  let hardware: ReplicateHardwarePin = {
    sku: REPLICATE_A100_80GB_SKU,
    pinMode: 'model_dashboard',
    deployment: null,
  };
  let hardwareError: string | null = null;
  let deploymentError: string | null = null;

  try {
    hardware = getReplicateHardwarePin();
  } catch (error) {
    hardwareError = error instanceof Error ? error.message : 'REPLICATE_HARDWARE is invalid.';
  }

  const deploymentConfigured = hardware.deployment !== null;
  if (tokenConfigured && modelVersion && !deploymentConfigured && !hardwareError) {
    deploymentError = describeMissingReplicateDeployment();
  }

  const operatorMessage = !tokenConfigured
    ? describeMissingReplicateToken()
    : !modelVersion
      ? (versionError ?? describeMissingReplicateModelVersion())
      : (deploymentError ?? hardwareError);

  return {
    tokenConfigured,
    modelVersionConfigured: modelVersion !== null,
    deploymentConfigured,
    modelVersion,
    hardware,
    operatorMessage,
  };
}

export function parseAnnyFitModelVersionRef(configured: string): AnnyFitModelVersionRef {
  if (ANNY_FIT_VERSION_ID_PATTERN.test(configured)) {
    return {
      configured,
      versionId: configured.toLowerCase(),
      owner: null,
      name: null,
    };
  }

  const namedMatch = configured.match(ANNY_FIT_NAMED_VERSION_PATTERN);
  if (!namedMatch || !namedMatch[1] || !namedMatch[2] || !namedMatch[3]) {
    throw new Error(
      'REPLICATE_HMR_MODEL_VERSION must be a 64-character Cog version hash, or owner/name:<hash>',
    );
  }

  return {
    configured,
    owner: namedMatch[1],
    name: namedMatch[2],
    versionId: namedMatch[3].toLowerCase(),
  };
}

export function getAnnyFitModelVersion(): string {
  const modelVersion = process.env.REPLICATE_HMR_MODEL_VERSION?.trim();
  if (!modelVersion) {
    throw new Error(describeMissingReplicateModelVersion());
  }

  parseAnnyFitModelVersionRef(modelVersion);
  return modelVersion;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  if (vertices) {
    if (vertices.length !== MHR_VERTEX_COUNT * 3) {
      throw new Error(
        `MHR vertex_positions must contain ${MHR_VERTEX_COUNT * 3} values (LOD 1 xyz)`,
      );
    }

    result.vertex_positions = vertices;
  }

  if (typeof unwrapped.vertex_storage_url === 'string' && unwrapped.vertex_storage_url.length > 0) {
    result.vertex_storage_url = unwrapped.vertex_storage_url;
  }

  if (isFiniteNumber(unwrapped.height_residual_cm)) {
    result.height_residual_cm = unwrapped.height_residual_cm;
  }

  if (isFiniteNumber(unwrapped.clothing_residual)) {
    result.clothing_residual = unwrapped.clothing_residual;
  }

  return result;
}

function buildBodyPredictionInput(input: RunAnnyFitInput): Record<string, unknown> {
  const predictionInput: Record<string, unknown> = {
    task: 'body',
    front_image: input.frontImageUrl,
    side_image: input.sideImageUrl,
    height_cm: input.heightCm,
    sex: input.sex,
  };

  if (input.weightKg !== undefined) {
    predictionInput.weight_kg = input.weightKg;
  }

  return predictionInput;
}

function replicateAuthHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${getReplicateApiToken()}`,
    'Content-Type': 'application/json',
  };
}

function predictionRequestUrl(deployment: ReplicateDeploymentRef): string {
  return `https://api.replicate.com/v1/deployments/${encodeURIComponent(deployment.owner)}/${encodeURIComponent(deployment.name)}/predictions`;
}

function deploymentUrl(deployment: ReplicateDeploymentRef): string {
  return `https://api.replicate.com/v1/deployments/${encodeURIComponent(deployment.owner)}/${encodeURIComponent(deployment.name)}`;
}

function readOptionalInt(value: unknown): number | null {
  return isFiniteNumber(value) ? Math.trunc(value) : null;
}

function readDeploymentStatus(
  payload: unknown,
  fallback: ReplicateDeploymentRef,
): ReplicateDeploymentStatus {
  if (!isRecord(payload) || !isRecord(payload.current_release)) {
    return {
      owner: fallback.owner,
      name: fallback.name,
      hardware: null,
      minInstances: null,
      maxInstances: null,
      model: null,
      version: null,
    };
  }

  const release = payload.current_release;
  const configuration = isRecord(release.configuration) ? release.configuration : {};

  return {
    owner: typeof payload.owner === 'string' ? payload.owner : fallback.owner,
    name: typeof payload.name === 'string' ? payload.name : fallback.name,
    hardware: typeof configuration.hardware === 'string' ? configuration.hardware : null,
    minInstances: readOptionalInt(configuration.min_instances),
    maxInstances: readOptionalInt(configuration.max_instances),
    model: typeof release.model === 'string' ? release.model : null,
    version: typeof release.version === 'string' ? release.version : null,
  };
}

async function fetchReplicateDeployment(
  deployment: ReplicateDeploymentRef,
): Promise<ReplicateDeploymentStatus> {
  const response = await fetch(deploymentUrl(deployment), {
    headers: { Authorization: `Bearer ${getReplicateApiToken()}` },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Replicate deployment lookup failed (${response.status}): ${errorBody || response.statusText}`,
    );
  }

  return readDeploymentStatus(await response.json(), deployment);
}

/**
 * Deployments can pin hardware and min_instances. Model versions cannot:
 * POST /v1/predictions has no `hardware` field (Replicate HTTP API).
 */
export async function patchReplicateDeployment(options: {
  minInstances?: 0 | 1;
  pinHardware?: boolean;
}): Promise<{
  status: ReplicateDeploymentStatus;
  hardwareUpdated: boolean;
  minInstancesUpdated: boolean;
}> {
  const deployment = requireReplicateDeploymentRef();
  const sku = getReplicateHardwareSku();
  const current = await fetchReplicateDeployment(deployment);
  const body: Record<string, unknown> = {};
  let hardwareUpdated = false;
  let minInstancesUpdated = false;

  if (options.pinHardware !== false && current.hardware !== sku) {
    body.hardware = sku;
    hardwareUpdated = true;
  }

  if (options.minInstances !== undefined && current.minInstances !== options.minInstances) {
    body.min_instances = options.minInstances;
    minInstancesUpdated = true;
    if (options.minInstances === 1) {
      body.max_instances = Math.max(current.maxInstances ?? 0, 1);
    }
  }

  if (Object.keys(body).length === 0) {
    return { status: current, hardwareUpdated: false, minInstancesUpdated: false };
  }

  const updateResponse = await fetch(deploymentUrl(deployment), {
    method: 'PATCH',
    headers: replicateAuthHeaders(),
    body: JSON.stringify(body),
  });

  if (!updateResponse.ok) {
    const errorBody = await updateResponse.text();
    throw new Error(
      `Replicate deployment PATCH failed (${updateResponse.status}): ${errorBody || updateResponse.statusText}`,
    );
  }

  return {
    status: readDeploymentStatus(await updateResponse.json(), deployment),
    hardwareUpdated,
    minInstancesUpdated,
  };
}

export async function pinReplicateDeploymentHardware(): Promise<{
  hardware: string | null;
  updated: boolean;
} | null> {
  const patched = await patchReplicateDeployment({ pinHardware: true });
  return {
    hardware: patched.status.hardware,
    updated: patched.hardwareUpdated,
  };
}

/**
 * Always async. The GPU is scaled to zero unless the sandbox session set
 * min_instances=1, so a cold boot can outlast any synchronous Prefer: wait
 * budget; completion arrives by webhook instead.
 */
async function requestReplicatePrediction(
  body: Record<string, unknown>,
): Promise<ReplicatePredictionResponse> {
  const deployment = requireReplicateDeploymentRef();
  const payload: Record<string, unknown> = {
    input: body.input,
    ...(typeof body.webhook === 'string' ? { webhook: body.webhook } : {}),
    ...(Array.isArray(body.webhook_events_filter)
      ? { webhook_events_filter: body.webhook_events_filter }
      : {}),
  };

  const response = await fetch(predictionRequestUrl(deployment), {
    method: 'POST',
    headers: replicateAuthHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Replicate API request failed (${response.status}): ${errorBody || response.statusText}`,
    );
  }

  return (await response.json()) as ReplicatePredictionResponse;
}

export async function dispatchAnnyFitPrediction(
  input: DispatchAnnyFitPredictionInput,
): Promise<ReplicatePredictionReceipt> {
  requireReplicateDeploymentRef();
  getAnnyFitModelVersion();

  const prediction = await requestReplicatePrediction({
    input: buildBodyPredictionInput(input),
    webhook: input.webhookUrl,
    webhook_events_filter: ['completed'],
  });

  if (typeof prediction.id !== 'string' || typeof prediction.status !== 'string') {
    throw new Error('Replicate prediction dispatch returned an invalid response.');
  }

  return {
    id: prediction.id,
    status: prediction.status,
  };
}

export async function confirmAnnyFitCogVersion(): Promise<AnnyFitCogVersionConfirmation> {
  const configured = getAnnyFitModelVersion();
  const parsed = parseAnnyFitModelVersionRef(configured);

  if (!parsed.owner || !parsed.name) {
    return {
      ...parsed,
      cogVersion: null,
    };
  }

  const response = await fetch(
    `https://api.replicate.com/v1/models/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.name)}/versions/${parsed.versionId}`,
    {
      headers: {
        Authorization: `Bearer ${getReplicateApiToken()}`,
      },
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Replicate Cog version lookup failed (${response.status}): ${errorBody || response.statusText}`,
    );
  }

  const payload: unknown = await response.json();
  if (!isRecord(payload) || payload.id !== parsed.versionId) {
    throw new Error('Replicate Cog version response did not match REPLICATE_HMR_MODEL_VERSION');
  }

  return {
    ...parsed,
    cogVersion: typeof payload.cog_version === 'string' ? payload.cog_version : null,
  };
}

function versionMatchesDeployment(
  confirmation: AnnyFitCogVersionConfirmation,
  status: ReplicateDeploymentStatus,
): boolean {
  if (!status.version) {
    return false;
  }

  return status.version.toLowerCase() === confirmation.versionId;
}

export async function readReplicateSessionGpu(): Promise<SessionGpuResult> {
  const confirmation = await confirmAnnyFitCogVersion();
  const hardware = getReplicateHardwarePin();
  const deployment = await fetchReplicateDeployment(requireReplicateDeploymentRef());

  return {
    action: 'status',
    confirmation,
    hardware,
    deployment,
    hardwareUpdated: false,
    minInstancesUpdated: false,
    versionMatchesDeployment: versionMatchesDeployment(confirmation, deployment),
  };
}

export async function setReplicateSessionGpu(action: 'warm' | 'sleep'): Promise<SessionGpuResult> {
  const confirmation = await confirmAnnyFitCogVersion();
  const hardware = getReplicateHardwarePin();
  const patched = await patchReplicateDeployment({
    minInstances: action === 'warm' ? 1 : 0,
    pinHardware: true,
  });

  return {
    action,
    confirmation,
    hardware,
    deployment: patched.status,
    hardwareUpdated: patched.hardwareUpdated,
    minInstancesUpdated: patched.minInstancesUpdated,
    versionMatchesDeployment: versionMatchesDeployment(confirmation, patched.status),
  };
}
