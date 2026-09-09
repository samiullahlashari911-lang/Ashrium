import {
  readFitParametricVector,
  type CaptureSex,
  type FitJobPublicStatus,
  type FitJobStatusPayload,
} from '@/types/hmr';

export interface DualUploadTargets {
  jobId: string;
  front: { filePath: string };
  side: { filePath: string };
}

export interface AnnyFitDispatchInput {
  frontImagePath: string;
  sideImagePath: string;
  heightCm: number;
  sex: CaptureSex;
  weightKg?: number;
}

function authHeaders(embedToken: string | null, json = false): HeadersInit {
  const headers: Record<string, string> = {};
  if (json) {
    headers['Content-Type'] = 'application/json';
  }

  if (embedToken) {
    headers.Authorization = `Bearer ${embedToken}`;
  }

  return headers;
}

async function readErrorCode(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (typeof payload === 'object' && payload !== null) {
      const record = payload as { code?: unknown; message?: unknown };
      if (typeof record.message === 'string' && record.message.trim().length > 0) {
        return record.message.trim();
      }
      if (typeof record.code === 'string' && record.code.length > 0) {
        return record.code;
      }
    }
  } catch {
    // Fall through to status text.
  }

  return response.statusText || `HTTP_${response.status}`;
}

export async function uploadDualHeadlessWebps(
  embedToken: string | null,
  frontBlob: Blob,
  sideBlob: Blob,
): Promise<DualUploadTargets> {
  const form = new FormData();
  form.append('front', new File([frontBlob], 'front.webp', { type: 'image/webp' }));
  form.append('side', new File([sideBlob], 'side.webp', { type: 'image/webp' }));

  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), 45_000);

  let response: Response;
  try {
    response = await fetch('/api/v1/biometrics/upload', {
      method: 'POST',
      credentials: 'same-origin',
      headers: authHeaders(embedToken),
      body: form,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Biometric upload timed out. Check the network and try again.');
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`Biometric upload failed (${await readErrorCode(response)}).`);
  }

  const payload: unknown = await response.json();
  if (
    typeof payload !== 'object'
    || payload === null
    || typeof Reflect.get(payload, 'job_id') !== 'string'
  ) {
    throw new Error('Upload response was invalid.');
  }

  const record = payload as {
    job_id: string;
    front?: { file_path?: string };
    side?: { file_path?: string };
  };

  if (!record.front?.file_path || !record.side?.file_path) {
    throw new Error('Upload response was incomplete.');
  }

  return {
    jobId: record.job_id,
    front: { filePath: record.front.file_path },
    side: { filePath: record.side.file_path },
  };
}

export async function warmShopperGpu(embedToken: string | null): Promise<void> {
  try {
    await fetch('/api/v1/hmr/warmup', {
      method: 'POST',
      credentials: 'same-origin',
      headers: authHeaders(embedToken, true),
    });
  } catch {
    // Submit still warms; capture continues without blocking the camera.
  }
}

export async function dispatchAnnyFitJob(
  embedToken: string | null,
  input: AnnyFitDispatchInput,
): Promise<{ jobId: string; status: FitJobPublicStatus }> {
  const response = await fetch('/api/v1/hmr', {
    method: 'POST',
    credentials: 'same-origin',
    headers: authHeaders(embedToken, true),
    body: JSON.stringify(input),
  });

  if (!response.ok && response.status !== 202) {
    throw new Error(`Unable to start avatar inference (${await readErrorCode(response)}).`);
  }

  const payload: unknown = await response.json();
  if (
    typeof payload !== 'object'
    || payload === null
    || typeof Reflect.get(payload, 'job_id') !== 'string'
  ) {
    throw new Error('ANNY-Fit dispatch response was invalid.');
  }

  const record = payload as { job_id: string; status?: string };
  const status = record.status;
  if (
    status !== 'pending'
    && status !== 'processing'
    && status !== 'completed'
    && status !== 'failed'
  ) {
    return { jobId: record.job_id, status: 'pending' };
  }

  return { jobId: record.job_id, status };
}

export async function fetchFitJobStatus(
  embedToken: string | null,
  jobId: string,
): Promise<FitJobStatusPayload> {
  const response = await fetch(`/api/v1/hmr/status?job_id=${encodeURIComponent(jobId)}`, {
    credentials: 'same-origin',
    headers: authHeaders(embedToken),
  });

  if (!response.ok) {
    throw new Error(`Unable to read fit job status (${await readErrorCode(response)}).`);
  }

  const payload: unknown = await response.json();
  if (typeof payload !== 'object' || payload === null || !('job' in payload)) {
    throw new Error('Fit job status response was invalid.');
  }

  const job = (payload as { job: unknown }).job;
  if (typeof job !== 'object' || job === null) {
    throw new Error('Fit job status response was incomplete.');
  }

  const record = job as Record<string, unknown>;
  const status = record.status;
  if (
    typeof record.id !== 'string'
    || (
      status !== 'pending'
      && status !== 'processing'
      && status !== 'completed'
      && status !== 'failed'
    )
  ) {
    throw new Error('Fit job status payload was invalid.');
  }

  return {
    id: record.id,
    status,
    parametric_result: readFitParametricVector(record.parametric_result),
    error_message: typeof record.error_message === 'string' ? record.error_message : null,
  };
}

export async function uploadDualWebpAndDispatch(
  embedToken: string | null,
  input: {
    frontBlob: Blob;
    sideBlob: Blob;
    heightCm: number;
    sex: CaptureSex;
    weightKg?: number;
  },
): Promise<{ jobId: string }> {
  const targets = await uploadDualHeadlessWebps(embedToken, input.frontBlob, input.sideBlob);

  const dispatch = await dispatchAnnyFitJob(embedToken, {
    frontImagePath: targets.front.filePath,
    sideImagePath: targets.side.filePath,
    heightCm: input.heightCm,
    sex: input.sex,
    weightKg: input.weightKg,
  });

  return { jobId: dispatch.jobId };
}

export interface FitRecommendResponse {
  size: {
    code: string;
    source: 'variant' | 'ease_chart';
    variantId: string | null;
    chestCm: number;
    waistCm: number;
    hipCm: number;
    lengthCm: number;
  };
  gate: {
    highConfidence: boolean;
    capturePassed: boolean;
    ingestPassed: boolean;
    drapePassed: boolean;
    residualPassed: boolean;
    printPassed?: boolean;
    hnswSimilarity: number | null;
    xpbdCompleted: boolean;
  };
  category: 'tee' | 'pant' | 'dress' | 'outerwear' | 'other' | null;
  ease: { chestCm: number; waistCm: number; hipCm: number };
  sku: string;
}

function isFitRecommendResponse(value: unknown): value is FitRecommendResponse {
  if (!isRecord(value) || !isRecord(value.size) || !isRecord(value.gate) || !isRecord(value.ease)) {
    return false;
  }

  return (
    typeof value.size.code === 'string'
    && (value.size.source === 'variant' || value.size.source === 'ease_chart')
    && (value.size.variantId === null || typeof value.size.variantId === 'string')
    && typeof value.size.chestCm === 'number'
    && typeof value.size.waistCm === 'number'
    && typeof value.size.hipCm === 'number'
    && typeof value.size.lengthCm === 'number'
    && typeof value.gate.highConfidence === 'boolean'
    && typeof value.gate.capturePassed === 'boolean'
    && typeof value.gate.ingestPassed === 'boolean'
    && typeof value.gate.drapePassed === 'boolean'
    && typeof value.gate.residualPassed === 'boolean'
    && (value.gate.printPassed === undefined || typeof value.gate.printPassed === 'boolean')
    && (value.gate.hnswSimilarity === null || typeof value.gate.hnswSimilarity === 'number')
    && typeof value.gate.xpbdCompleted === 'boolean'
    && typeof value.sku === 'string'
    && typeof value.ease.chestCm === 'number'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function fetchFitRecommendation(
  embedToken: string | null,
  input: { jobId: string; sku: string; captureGatesPassed: boolean },
): Promise<FitRecommendResponse> {
  const response = await fetch('/api/v1/fit/recommend', {
    method: 'POST',
    credentials: 'same-origin',
    headers: authHeaders(embedToken, true),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`Unable to recommend a size (${await readErrorCode(response)}).`);
  }

  const payload: unknown = await response.json();
  if (!isFitRecommendResponse(payload)) {
    throw new Error('Size recommendation response was invalid.');
  }

  return payload;
}

export interface FitResolveResponse {
  source: 'cache' | 'xpbd' | 'unavailable';
  similarity: number | null;
  xpbdCompleted: boolean;
  topologyVersion: string;
  meanStrain: number | null;
  payloadBase64: string | null;
}

function isFitResolveResponse(value: unknown): value is FitResolveResponse {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.source === 'cache' || value.source === 'xpbd' || value.source === 'unavailable')
    && (value.similarity === null || typeof value.similarity === 'number')
    && typeof value.xpbdCompleted === 'boolean'
    && typeof value.topologyVersion === 'string'
    && (value.meanStrain === null || typeof value.meanStrain === 'number')
    && (value.payloadBase64 === null || typeof value.payloadBase64 === 'string')
  );
}

export async function fetchFitDrapeResolve(
  embedToken: string | null,
  input: { jobId: string; sku: string; allowXpbd?: boolean },
): Promise<FitResolveResponse> {
  const response = await fetch('/api/v1/fit/resolve', {
    method: 'POST',
    credentials: 'same-origin',
    headers: authHeaders(embedToken, true),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`Unable to resolve garment drape (${await readErrorCode(response)}).`);
  }

  const payload: unknown = await response.json();
  if (!isFitResolveResponse(payload)) {
    throw new Error('Drape resolve response was invalid.');
  }

  return payload;
}
