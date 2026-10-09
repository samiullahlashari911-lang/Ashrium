import { shopifyAppForShop, shopifyAppForTenant } from '@/lib/server/shopify-app';
import {
  completeShopifyOAuthConnection,
  normalizeShopifyShopDomain,
  parseShopifyOAuthState,
  peekShopifyOAuthStateTenantId,
  resolveShopifyOAuthAppRedirect,
  verifyShopifyCallbackHmac,
  type ShopifyOAuthConfig,
} from '@/lib/server/shopify-oauth';
import { requireCurrentTenantId } from '@/lib/supabase/tenant';

export const runtime = 'nodejs';

function readOAuthErrorMessage(query: URLSearchParams): string | null {
  const error = query.get('error');
  if (!error) {
    return null;
  }

  const description = query.get('error_description')?.trim();
  if (description) {
    return description;
  }

  return 'Shopify authorization was denied or cancelled.';
}

function redirectToApp(
  request: Request,
  returnTo: string,
  outcome: 'connected' | 'error',
  message?: string,
): Response {
  return Response.redirect(
    resolveShopifyOAuthAppRedirect(request.url, returnTo, outcome, message),
    302,
  );
}

export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const fallbackReturnTo = '/settings/integrations';
  const oauthError = readOAuthErrorMessage(query);
  if (oauthError) {
    return redirectToApp(request, fallbackReturnTo, 'error', oauthError);
  }

  const stateParam = query.get('state') ?? '';
  const invalidState = (): Response => redirectToApp(
    request,
    fallbackReturnTo,
    'error',
    'Shopify OAuth state was invalid or expired.',
  );

  // The state names its tenant; that tenant's app secret is what verifies it.
  const claimedTenantId = peekShopifyOAuthStateTenantId(stateParam);
  if (!claimedTenantId) {
    return invalidState();
  }

  let app: ShopifyOAuthConfig;
  try {
    app = await shopifyAppForTenant(claimedTenantId);
  } catch {
    return redirectToApp(
      request,
      fallbackReturnTo,
      'error',
      'Shopify OAuth is not configured on this deployment.',
    );
  }

  const state = parseShopifyOAuthState(stateParam, app);
  if (!state) {
    return invalidState();
  }

  if (!verifyShopifyCallbackHmac(query, app.clientSecret)) {
    return redirectToApp(request, state.returnTo, 'error', 'Shopify callback signature was invalid.');
  }

  // The shared app's state is signed but not tied to a browser, so a link
  // started by one merchant must not attach a shop from someone else's
  // session. A client's own app can only be installed on the shop the
  // operator registered for that tenant, so its install needs no session.
  if (!app.perClient) {
    let sessionTenantId: string | null = null;
    try {
      sessionTenantId = await requireCurrentTenantId();
    } catch {
      sessionTenantId = null;
    }
    if (sessionTenantId !== state.tenantId) {
      return redirectToApp(
        request,
        state.returnTo,
        'error',
        'Sign in to the Ashrium account that started this connection, then try again.',
      );
    }
  }

  const shopDomain = normalizeShopifyShopDomain(query.get('shop') ?? '');
  const code = query.get('code')?.trim() ?? '';

  if (!shopDomain) {
    return redirectToApp(request, state.returnTo, 'error', 'Shopify returned an unexpected shop domain.');
  }

  if (code.length === 0) {
    return redirectToApp(request, state.returnTo, 'error', 'Shopify did not return an authorization code.');
  }

  if (app.perClient && (await shopifyAppForShop(shopDomain))?.tenantId !== state.tenantId) {
    return redirectToApp(
      request,
      state.returnTo,
      'error',
      `${shopDomain} is not the store registered for this Ashrium account.`,
    );
  }

  try {
    const result = await completeShopifyOAuthConnection({
      tenantId: state.tenantId,
      shopDomain,
      requestedShopDomain: state.shopDomain,
      code,
      app,
    });

    return redirectToApp(
      request,
      state.returnTo,
      'connected',
      `Connected to ${result.shopDomain}. Test one SKU on Garments — full catalog sync is optional.`,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Shopify OAuth token exchange failed.';

    return redirectToApp(request, state.returnTo, 'error', message);
  }
}
