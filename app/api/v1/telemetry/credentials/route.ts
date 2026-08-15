import { provisionTelemetryWebhookSecret } from '@/lib/server/telemetry-webhook';
import { requireCurrentTenantId } from '@/lib/supabase/tenant';

export const runtime = 'nodejs';

export async function POST(): Promise<Response> {
  try {
    await requireCurrentTenantId();
  } catch {
    return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const credentials = await provisionTelemetryWebhookSecret();

    return Response.json(
      {
        tenant_id: credentials.tenantId,
        webhook_secret: credentials.secret,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch {
    return Response.json({ code: 'CREDENTIAL_PROVISION_FAILED' }, { status: 500 });
  }
}
