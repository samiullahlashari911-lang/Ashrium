const CORS_TTL_MS = 10 * 60 * 1000;
let lastConfiguredAt = 0;
let inFlight: Promise<void> | null = null;

function appOrigin(): string | null {
  const raw = process.env.APP_BASE_URL?.trim();
  if (!raw) {
    return null;
  }

  try {
    const origin = new URL(raw).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

/**
 * Browser signed PUTs come from the Ashrium iframe origin (APP_BASE_URL),
 * not the Shopify host. Without this CORS rule the PUT fails and the client
 * falls back to the slow Vercel proxy.
 */
export async function configureBiometricsBucketCors(): Promise<void> {
  const origin = appOrigin();
  if (!origin) {
    return;
  }

  if (Date.now() - lastConfiguredAt < CORS_TTL_MS) {
    return;
  }

  if (inFlight) {
    await inFlight;
    return;
  }

  inFlight = (async () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!supabaseUrl || !serviceKey) {
      return;
    }

    const payload = [
      {
        allowedOrigins: [origin],
        allowedMethods: ['PUT', 'GET', 'HEAD'],
        allowedHeaders: ['authorization', 'x-client-info', 'apikey', 'content-type', 'x-upsert'],
        exposeHeaders: ['etag', 'content-type'],
        maxAgeSeconds: 3600,
      },
    ];

    try {
      const response = await fetch(`${supabaseUrl}/storage/v1/bucket/biometrics`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          public: false,
          allowedMimeTypes: ['image/webp'],
          fileSizeLimit: '5242880',
          cors: payload,
        }),
      });

      if (!response.ok) {
        await fetch(`${supabaseUrl}/storage/v1/s3/cors`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
      }

      lastConfiguredAt = Date.now();
    } catch {
      // Client PUT has a proxy fallback if CORS is still missing.
    }
  })();

  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}
