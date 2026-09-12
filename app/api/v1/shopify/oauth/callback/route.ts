import {
  completeShopifyOAuthConnection,
  getShopifyOAuthConfig,
  normalizeShopifyShopDomain,
  parseShopifyOAuthState,
  resolveShopifyOAuthAppRedirect,
  verifyShopifyCallbackHmac,
} from '@/lib/server/shopify-oauth';

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
  const state = parseShopifyOAuthState(stateParam);
  if (!state) {
    return redirectToApp(
      request,
      fallbackReturnTo,
      'error',
      'Shopify OAuth state was invalid or expired.',
    );
  }

  let config;
  try {
    config = getShopifyOAuthConfig();
  } catch {
    return redirectToApp(
      request,
      state.returnTo,
      'error',
      'Shopify OAuth is not configured on this deployment.',
    );
  }

  if (!verifyShopifyCallbackHmac(query, config.clientSecret)) {
    return redirectToApp(request, state.returnTo, 'error', 'Shopify callback signature was invalid.');
  }

  const shopDomain = normalizeShopifyShopDomain(query.get('shop') ?? '');
  const code = query.get('code')?.trim() ?? '';

  if (!shopDomain) {
    return redirectToApp(request, state.returnTo, 'error', 'Shopify returned an unexpected shop domain.');
  }

  if (code.length === 0) {
    return redirectToApp(request, state.returnTo, 'error', 'Shopify did not return an authorization code.');
  }

  try {
    const result = await completeShopifyOAuthConnection({
      tenantId: state.tenantId,
      shopDomain,
      requestedShopDomain: state.shopDomain,
      code,
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
