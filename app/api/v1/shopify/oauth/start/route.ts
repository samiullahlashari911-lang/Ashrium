import { isSafeAppPath } from '@/lib/safe-path';
import {
  buildShopifyAuthorizeUrl,
  createShopifyOAuthState,
  normalizeShopifyShopDomain,
  resolveShopifyOAuthAppRedirect,
} from '@/lib/server/shopify-oauth';
import { shopifyAppForTenant } from '@/lib/server/shopify-app';
import { requireCurrentTenantId } from '@/lib/supabase/tenant';

export const runtime = 'nodejs';

function readSafeReturnTo(value: string | null): string {
  const trimmed = (value ?? '/settings/integrations').trim();
  if (!isSafeAppPath(trimmed)) {
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

    const app = await shopifyAppForTenant(tenantId);
    const state = createShopifyOAuthState({ tenantId, shopDomain, returnTo }, app);
    const authorizeUrl = buildShopifyAuthorizeUrl(shopDomain, state, app);

    return Response.redirect(authorizeUrl, 302);
  } catch (error) {
    const message =
      error instanceof Error && error.message.includes('SHOPIFY_CLIENT')
        ? 'Shopify OAuth is not configured on this deployment.'
        : 'Sign in with an active merchant account before connecting Shopify.';

    return redirectToApp(request, returnTo, 'error', message);
  }
}
