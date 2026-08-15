import type { SmplxMeshGeometry, SmplxParameters } from '@/types/hmr';

const MOCK_DELAY_MS = 500;

const SMPLX_BETA_COUNT = 10;
const SMPLX_POSE_COUNT = 165;

export interface RunHmrEstimationInput {
  imageUrl: string;
}

export interface DispatchHmrPredictionInput extends RunHmrEstimationInput {
  webhookUrl: string;
}

export interface ReplicatePredictionReceipt {
  id: string;
  status: string;
}

interface ReplicatePredictionResponse {
  id: string;
  status: string;
  output: unknown;
  error: string | null;
}

export function isReplicateMockMode(): boolean {
  return process.env.REPLICATE_API_TOKEN === 'mock';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getReplicateApiToken(): string {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token || token === 'mock') {
    throw new Error('REPLICATE_API_TOKEN is required for live inference');
  }

  return token;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'number');
}

function appendBox(
  vertices: number[],
  faces: number[],
  centerX: number,
  centerY: number,
  centerZ: number,
  sizeX: number,
  sizeY: number,
  sizeZ: number,
): void {
  const halfX = sizeX / 2;
  const halfY = sizeY / 2;
  const halfZ = sizeZ / 2;
  const baseIndex = vertices.length / 3;

  const boxVertices: readonly [number, number, number][] = [
    [centerX - halfX, centerY - halfY, centerZ - halfZ],
    [centerX + halfX, centerY - halfY, centerZ - halfZ],
    [centerX + halfX, centerY + halfY, centerZ - halfZ],
    [centerX - halfX, centerY + halfY, centerZ - halfZ],
    [centerX - halfX, centerY - halfY, centerZ + halfZ],
    [centerX + halfX, centerY - halfY, centerZ + halfZ],
    [centerX + halfX, centerY + halfY, centerZ + halfZ],
    [centerX - halfX, centerY + halfY, centerZ + halfZ],
  ];

  for (const [x, y, z] of boxVertices) {
    vertices.push(x, y, z);
  }

  const boxFaces: readonly [number, number, number][] = [
    [0, 1, 2],
    [0, 2, 3],
    [4, 6, 5],
    [4, 7, 6],
    [0, 4, 5],
    [0, 5, 1],
    [2, 6, 7],
    [2, 7, 3],
    [0, 3, 7],
    [0, 7, 4],
    [1, 5, 6],
    [1, 6, 2],
  ];

  for (const [a, b, c] of boxFaces) {
    faces.push(baseIndex + a, baseIndex + b, baseIndex + c);
  }
}

function buildMockMeshGeometry(): SmplxMeshGeometry {
  const vertices: number[] = [];
  const faces: number[] = [];

  appendBox(vertices, faces, 0, 1.62, 0, 0.2, 0.24, 0.2);
  appendBox(vertices, faces, 0, 1.25, 0, 0.42, 0.55, 0.22);
  appendBox(vertices, faces, -0.28, 1.05, 0, 0.14, 0.42, 0.14);
  appendBox(vertices, faces, 0.28, 1.05, 0, 0.14, 0.42, 0.14);
  appendBox(vertices, faces, -0.12, 0.55, 0, 0.16, 0.48, 0.16);
  appendBox(vertices, faces, 0.12, 0.55, 0, 0.16, 0.48, 0.16);
  appendBox(vertices, faces, -0.12, 0.1, 0, 0.14, 0.5, 0.14);
  appendBox(vertices, faces, 0.12, 0.1, 0, 0.14, 0.5, 0.14);

  return { vertices, faces };
}

function buildMockSmplxParameters(): SmplxParameters {
  const betas = [
    0.12,
    -0.08,
    0.05,
    0.03,
    -0.02,
    0.01,
    -0.04,
    0.06,
    -0.01,
    0.02,
  ];

  const pose = Array.from({ length: SMPLX_POSE_COUNT }, (_, index) => {
    if (index < 3) {
      return 0.08;
    }

    if (index >= 3 && index < 6) {
      return -0.04;
    }

    return index % 11 === 0 ? 0.015 : 0;
  });

  const trans: [number, number, number] = [0.0, 0.0, 2.4];

  return {
    betas,
    pose,
    trans,
    mesh: buildMockMeshGeometry(),
  };
}

function parseMeshGeometry(value: unknown): SmplxMeshGeometry {
  if (!isRecord(value)) {
    throw new Error('Replicate output mesh must be an object');
  }

  const { vertices, faces } = value;

  if (!isNumberArray(vertices)) {
    throw new Error('Replicate output mesh.vertices must be a number array');
  }

  if (!isNumberArray(faces)) {
    throw new Error('Replicate output mesh.faces must be a number array');
  }

  return { vertices, faces };
}

function mapReplicateOutputToSmplxParameters(output: unknown): SmplxParameters {
  if (!isRecord(output)) {
    throw new Error('Replicate output must be an object');
  }

  const betas = output.betas;
  const pose = output.pose;
  const trans = output.trans;
  const mesh = output.mesh;

  if (!isNumberArray(betas) || betas.length !== SMPLX_BETA_COUNT) {
    throw new Error(`Replicate output betas must contain ${SMPLX_BETA_COUNT} values`);
  }

  if (!isNumberArray(pose) || pose.length !== SMPLX_POSE_COUNT) {
    throw new Error(`Replicate output pose must contain ${SMPLX_POSE_COUNT} values`);
  }

  if (!isNumberArray(trans) || trans.length !== 3) {
    throw new Error('Replicate output trans must contain 3 values');
  }

  return {
    betas,
    pose,
    trans,
    mesh: parseMeshGeometry(mesh),
  };
}

async function executeReplicateHmr(input: RunHmrEstimationInput): Promise<SmplxParameters> {
  const token = getReplicateApiToken();
  const modelVersion = process.env.REPLICATE_HMR_MODEL_VERSION?.trim();

  if (!modelVersion) {
    throw new Error('Missing environment variable: REPLICATE_HMR_MODEL_VERSION');
  }

  const response = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'wait=60',
    },
    body: JSON.stringify({
      version: modelVersion,
      input: {
        image: input.imageUrl,
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Replicate API request failed (${response.status}): ${errorBody || response.statusText}`,
    );
  }

  const prediction = (await response.json()) as ReplicatePredictionResponse;

  if (prediction.status !== 'succeeded') {
    throw new Error(
      prediction.error ?? `Replicate prediction failed with status: ${prediction.status}`,
    );
  }

  return mapReplicateOutputToSmplxParameters(prediction.output);
}

export async function dispatchHmrPrediction(
  input: DispatchHmrPredictionInput,
): Promise<ReplicatePredictionReceipt> {
  const token = getReplicateApiToken();
  const modelVersion = process.env.REPLICATE_HMR_MODEL_VERSION?.trim();

  if (!modelVersion) {
    throw new Error('Missing environment variable: REPLICATE_HMR_MODEL_VERSION');
  }

  const response = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: modelVersion,
      input: {
        image: input.imageUrl,
      },
      webhook: input.webhookUrl,
      webhook_events_filter: ['completed'],
    }),
  });

  if (!response.ok) {
    throw new Error(`Replicate prediction dispatch failed (${response.status}).`);
  }

  const prediction: unknown = await response.json();
  if (!isRecord(prediction) || typeof prediction.id !== 'string' || typeof prediction.status !== 'string') {
    throw new Error('Replicate prediction dispatch returned an invalid response.');
  }

  return {
    id: prediction.id,
    status: prediction.status,
  };
}

export async function runHmrEstimation(input: RunHmrEstimationInput): Promise<SmplxParameters> {
  if (isReplicateMockMode()) {
    await sleep(MOCK_DELAY_MS);
    return buildMockSmplxParameters();
  }

  return executeReplicateHmr(input);
}
