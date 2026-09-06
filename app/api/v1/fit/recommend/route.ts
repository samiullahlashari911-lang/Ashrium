import { isAnnyParametricVector, readFitParametricVector } from '@/types/hmr';
import { recommendFit } from '@/lib/fit/recommend';
import { recommendSize } from '@/lib/fit/size-recommend';
import { matchSimulationCache } from '@/lib/fit/simulation-match';
import { consumeRateLimit } from '@/lib/server/durable-rate-limit';
import { parseRecommendRequest } from '@/lib/server/fit-request';
import { RATE_LIMITS, RATE_LIMIT_WINDOW_MS } from '@/lib/server/rate-limit';
import { resolveRequestTenantId } from '@/lib/server/request-tenant';
import { fetchGarmentBySkuWithVariants, toStorefrontGarment } from '@/lib/supabase/garment-profiles';
import { createServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  }

  const body = parseRecommendRequest(payload);
  if (!body) {
    return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  }

  let tenantId: string;
  try {
    tenantId = await resolveRequestTenantId(request);
  } catch {
    return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const rateLimit = await consumeRateLimit(
    `fit-recommend:${tenantId}`,
    RATE_LIMITS.fitRecommend,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!rateLimit.allowed) {
    return Response.json({ code: 'RATE_LIMIT_EXCEEDED' }, { status: 429 });
  }

  const supabase = createServiceClient();
  const { data: job, error: jobError } = await supabase
    .from('fit_jobs')
    .select('id, status, parametric_result')
    .eq('id', body.jobId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (jobError) {
    return Response.json({ code: 'JOB_LOOKUP_FAILED' }, { status: 500 });
  }

  if (!job) {
    return Response.json({ code: 'JOB_NOT_FOUND' }, { status: 404 });
  }

  if (job.status !== 'completed') {
    return Response.json({ code: 'JOB_NOT_READY' }, { status: 409 });
  }

  const parametric = readFitParametricVector(job.parametric_result);
  if (!parametric) {
    return Response.json({ code: 'PARAMETRIC_UNAVAILABLE' }, { status: 409 });
  }

  const loaded = await fetchGarmentBySkuWithVariants(supabase, tenantId, body.sku.trim());
  const garment = loaded ? toStorefrontGarment(loaded.garment, loaded.variants) : null;
  const size = recommendSize(
    parametric.derived_measurements,
    garment?.category ?? null,
    garment?.sizeVariants ?? [],
  );

  const drape = isAnnyParametricVector(parametric)
    ? await matchSimulationCache({
        supabase,
        tenantId,
        variantId: size.variantId,
        phenotype: parametric.phenotype,
      })
    : { similarity: null, xpbdCompleted: false, row: null };

  const recommendation = recommendFit({
    measurements: parametric.derived_measurements,
    category: garment?.category ?? null,
    variants: garment?.sizeVariants ?? [],
    captureGatesPassed: body.captureGatesPassed,
    ingestTier: garment?.ingestTier ?? null,
    approximateFit: garment?.approximateFit ?? true,
    hnswSimilarity: drape.similarity,
    xpbdCompleted: drape.xpbdCompleted,
  });

  return Response.json({
    size: {
      code: recommendation.size.sizeCode,
      source: recommendation.size.source,
      variantId: recommendation.size.variantId,
      chestCm: recommendation.size.chestCm,
      waistCm: recommendation.size.waistCm,
      hipCm: recommendation.size.hipCm,
      lengthCm: recommendation.size.lengthCm,
    },
    gate: {
      highConfidence: recommendation.gate.highConfidence,
      capturePassed: recommendation.gate.capturePassed,
      ingestPassed: recommendation.gate.ingestPassed,
      drapePassed: recommendation.gate.drapePassed,
      hnswSimilarity: recommendation.gate.hnswSimilarity,
      xpbdCompleted: recommendation.gate.xpbdCompleted,
    },
    category: recommendation.category,
    ease: recommendation.ease,
    sku: body.sku.trim(),
  });
}
