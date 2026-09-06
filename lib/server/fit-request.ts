const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RecommendRequest {
  jobId: string;
  sku: string;
  captureGatesPassed: boolean;
}

export interface ResolveRequest {
  jobId: string;
  sku: string;
  allowXpbd?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isFitJobId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function parseRecommendRequest(value: unknown): RecommendRequest | null {
  if (
    !isRecord(value)
    || !isFitJobId(value.jobId)
    || typeof value.sku !== 'string'
    || value.sku.trim().length === 0
    || typeof value.captureGatesPassed !== 'boolean'
  ) {
    return null;
  }

  return {
    jobId: value.jobId,
    sku: value.sku,
    captureGatesPassed: value.captureGatesPassed,
  };
}

export function parseResolveRequest(value: unknown): ResolveRequest | null {
  if (
    !isRecord(value)
    || !isFitJobId(value.jobId)
    || typeof value.sku !== 'string'
    || value.sku.trim().length === 0
    || (value.allowXpbd !== undefined && typeof value.allowXpbd !== 'boolean')
  ) {
    return null;
  }

  return {
    jobId: value.jobId,
    sku: value.sku,
    ...(value.allowXpbd === undefined ? {} : { allowXpbd: value.allowXpbd }),
  };
}
