import { verifyTelemetryWebhook } from '@/lib/server/telemetry-webhook';
import { createServiceClient } from '@/lib/supabase/service';

interface TelemetryWebhookPayload {
  event: 'order' | 'refund';
  orderId: string;
  returnReason: string | null;
  sku: string;
  vfrUsed: boolean;
}

const MAX_ORDER_ID_LENGTH = 256;
const MAX_RETURN_REASON_LENGTH = 1024;
const MAX_SKU_LENGTH = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maximumLength;
}

function parsePayload(value: unknown): TelemetryWebhookPayload | null {
  if (!isRecord(value) || (value.event !== 'order' && value.event !== 'refund')) {
    return null;
  }

  if (
    !isBoundedString(value.order_id, MAX_ORDER_ID_LENGTH)
    || !isBoundedString(value.sku, MAX_SKU_LENGTH)
    || typeof value.vfr_used !== 'boolean'
  ) {
    return null;
  }

  if (
    value.return_reason !== undefined
    && value.return_reason !== null
    && !isBoundedString(value.return_reason, MAX_RETURN_REASON_LENGTH)
  ) {
    return null;
  }

  return {
    event: value.event,
    orderId: value.order_id.trim(),
    sku: value.sku.trim(),
    vfrUsed: value.vfr_used,
    returnReason: value.return_reason?.trim() ?? null,
  };
}

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const tenantId = await verifyTelemetryWebhook(rawBody, request.headers);

  if (!tenantId) {
    return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  }

  const payload = parsePayload(parsedBody);
  if (!payload) {
    return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  const { error } = await serviceClient.from('store_telemetry').upsert(
    {
      tenant_id: tenantId,
      order_id: payload.orderId,
      sku: payload.sku,
      vfr_used: payload.vfrUsed,
      returned: payload.event === 'refund',
      return_reason: payload.event === 'refund' ? payload.returnReason : null,
    },
    { onConflict: 'tenant_id,order_id,sku' },
  );

  if (error) {
    return Response.json({ code: 'TELEMETRY_UPSERT_FAILED' }, { status: 500 });
  }

  return Response.json({ accepted: true }, { status: 202 });
}
