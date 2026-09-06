import { cronSecretMatches, readBearerSecret, readCronSecret } from '@/lib/server/cron-secret';
import { operatorSecretMatches, readOperatorSecret } from '@/lib/server/operator-secret';

/**
 * Warm/Sleep is operator-only (ASHRIUM_OPERATOR_SECRET or CRON_SECRET).
 * Merchant session cookies must not scale the A100.
 */
export function authorizeGpuScaleRequest(request: Request): Response | null {
  const operatorSecret = readOperatorSecret();
  const cronSecret = readCronSecret();
  if (!operatorSecret && !cronSecret) {
    return Response.json({ code: 'GPU_CONTROL_UNCONFIGURED' }, { status: 503 });
  }

  const provided = readBearerSecret(request);
  if (!provided) {
    return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  }

  if (operatorSecret && operatorSecretMatches(provided, operatorSecret)) {
    return null;
  }

  if (cronSecret && cronSecretMatches(provided, cronSecret)) {
    return null;
  }

  return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });
}
