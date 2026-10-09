import { shopifyAppForShop } from '@/lib/server/shopify-app';
import {
  buildShopifyAuthorizeUrl,
  createShopifyOAuthState,
  normalizeShopifyShopDomain,
  verifyShopifyCallbackHmac,
} from '@/lib/server/shopify-oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LAUNCH_AGE_SECONDS = 60 * 60;

function installError(message: string, status: number): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ashrium</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;color:#1D1B22"><h1 style="font-size:1.4rem">Ashrium could not finish connecting</h1><p>${message}</p><p>Contact Ashrium and we will sort it out.</p></body>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}

/**
 * A client app's application_url. Shopify sends the merchant here (signed with
 * that app's secret) after they open their custom-distribution install link;
 * we start the authorization code grant for the tenant registered to the shop.
 */
export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const shopDomain = normalizeShopifyShopDomain(query.get('shop') ?? '');
  if (!shopDomain) {
    return installError('Shopify did not say which store is installing.', 400);
  }

  let registered;
  try {
    registered = await shopifyAppForShop(shopDomain);
  } catch {
    registered = null;
  }
  if (!registered || !registered.app.perClient) {
    return installError(`${shopDomain} is not registered with Ashrium yet.`, 404);
  }

  const timestamp = Number(query.get('timestamp'));
  const fresh = Number.isFinite(timestamp)
    && Math.abs(Math.floor(Date.now() / 1000) - timestamp) <= MAX_LAUNCH_AGE_SECONDS;
  if (!fresh || !verifyShopifyCallbackHmac(query, registered.app.clientSecret)) {
    return installError('This install request was not signed by Shopify, or it is too old. Open the install link again.', 401);
  }

  const state = createShopifyOAuthState(
    { tenantId: registered.tenantId, shopDomain, returnTo: '/onboarding' },
    registered.app,
  );
  return Response.redirect(buildShopifyAuthorizeUrl(shopDomain, state, registered.app), 302);
}
