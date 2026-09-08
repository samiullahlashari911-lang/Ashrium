import {
  buildShopifyOAuthRedirectUrl,
  completeShopifyOAuthConnection,
  getShopifyOAuthConfig,
  normalizeShopifyShopDomain,
  parseShopifyOAuthState,
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

export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const fallbackReturnTo = '/settings/integrations';
  const oauthError = readOAuthErrorMessage(query);
  if (oauthError) {
    return Response.redirect(buildShopifyOAuthRedirectUrl(fallbackReturnTo, 'error', oauthError), 302);
  }

  const stateParam = query.get('state') ?? '';
  const state = parseShopifyOAuthState(stateParam);
  if (!state) {
    return Response.redirect(
      buildShopifyOAuthRedirectUrl(fallbackReturnTo, 'error', 'Shopify OAuth state was invalid or expired.'),
      302,
    );
  }

  let config;
  try {
    config = getShopifyOAuthConfig();
  } catch {
    return Response.redirect(
      buildShopifyOAuthRedirectUrl(
        state.returnTo,
        'error',
        'Shopify OAuth is not configured on this deployment.',
      ),
      302,
    );
  }

  if (!verifyShopifyCallbackHmac(query, config.clientSecret)) {
    return Response.redirect(
      buildShopifyOAuthRedirectUrl(state.returnTo, 'error', 'Shopify callback signature was invalid.'),
      302,
    );
  }

  const shopDomain = normalizeShopifyShopDomain(query.get('shop') ?? '');
  const code = query.get('code')?.trim() ?? '';

  if (!shopDomain || shopDomain !== state.shopDomain) {
    return Response.redirect(
      buildShopifyOAuthRedirectUrl(state.returnTo, 'error', 'Shopify returned an unexpected shop domain.'),
      302,
    );
  }

  if (code.length === 0) {
    return Response.redirect(
      buildShopifyOAuthRedirectUrl(state.returnTo, 'error', 'Shopify did not return an authorization code.'),
      302,
    );
  }

  try {
    const result = await completeShopifyOAuthConnection({
      tenantId: state.tenantId,
      shopDomain,
      code,
    });

    return Response.redirect(
      buildShopifyOAuthRedirectUrl(
        state.returnTo,
        'connected',
        `Connected to ${result.shopDomain}. Test one SKU on Garments — full catalog sync is optional.`,
      ),
      302,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Shopify OAuth token exchange failed.';

    return Response.redirect(buildShopifyOAuthRedirectUrl(state.returnTo, 'error', message), 302);
  }
}
