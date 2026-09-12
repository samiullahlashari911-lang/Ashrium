import {
  buildShopifyAuthorizeUrl,
  createShopifyOAuthState,
  getShopifyOAuthConfig,
  normalizeShopifyShopDomain,
  resolveShopifyOAuthAppRedirect,
} from '@/lib/server/shopify-oauth';
import { requireCurrentTenantId } from '@/lib/supabase/tenant';

export const runtime = 'nodejs';

function readSafeReturnTo(value: string | null): string {
  const trimmed = (value ?? '/settings/integrations').trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return '/settings/integrations';
  }

  return trimmed;
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
  const returnTo = readSafeReturnTo(new URL(request.url).searchParams.get('return_to'));

  try {
    const tenantId = await requireCurrentTenantId();
    const shopInput = new URL(request.url).searchParams.get('shop') ?? '';
    const shopDomain = normalizeShopifyShopDomain(shopInput);

    if (!shopDomain) {
      return redirectToApp(request, returnTo, 'error', 'Enter a valid myshopify.com shop domain.');
    }

    getShopifyOAuthConfig();
    const state = createShopifyOAuthState({ tenantId, shopDomain, returnTo });
    const authorizeUrl = buildShopifyAuthorizeUrl(shopDomain, state);

    return Response.redirect(authorizeUrl, 302);
  } catch (error) {
    const message =
      error instanceof Error && error.message.includes('SHOPIFY_CLIENT')
        ? 'Shopify OAuth is not configured on this deployment.'
        : 'Sign in with an active merchant account before connecting Shopify.';

    return redirectToApp(request, returnTo, 'error', message);
  }
}
