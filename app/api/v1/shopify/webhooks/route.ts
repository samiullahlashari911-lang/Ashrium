import { shopifyAppForShop } from '@/lib/server/shopify-app';
import { normalizeShopifyShopDomain } from '@/lib/server/shopify-oauth';
import { readWebhookProductGid, verifyShopifyWebhookHmac } from '@/lib/server/shopify-webhook';
import { createServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Every client app subscribes here (shopify.app.<client>.toml). Unknown shops
 * and bad signatures get 401, which is what Shopify's review expects.
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const shopDomain = normalizeShopifyShopDomain(request.headers.get('x-shopify-shop-domain') ?? '');
  const topic = request.headers.get('x-shopify-topic')?.trim() ?? '';
  if (!shopDomain || !topic) {
    return new Response(null, { status: 401 });
  }

  let registered;
  try {
    registered = await shopifyAppForShop(shopDomain);
  } catch {
    registered = null;
  }
  if (
    !registered
    || !verifyShopifyWebhookHmac(rawBody, request.headers.get('x-shopify-hmac-sha256'), registered.app.clientSecret)
  ) {
    return new Response(null, { status: 401 });
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = null;
  }

  const { tenantId } = registered;
  const supabase = createServiceClient();

  switch (topic) {
    case 'products/delete': {
      const productGid = readWebhookProductGid(payload);
      if (productGid) {
        await supabase
          .from('garment_cad_profiles')
          .delete()
          .eq('tenant_id', tenantId)
          .eq('shopify_product_id', productGid);
      }
      break;
    }
    case 'app/uninstalled': {
      // Tokens die with the install. Keep the app credentials and shop so a
      // reinstall from the same install link reconnects the same tenant.
      await supabase
        .from('tenant_integrations')
        .update({
          is_active: false,
          shopify_admin_token_ciphertext: null,
          shopify_token_expires_at: null,
          shopify_refresh_token_ciphertext: null,
          shopify_refresh_token_expires_at: null,
        })
        .eq('tenant_id', tenantId)
        .eq('provider', 'shopify');
      break;
    }
    case 'shop/redact': {
      // 48h after uninstall Shopify asks us to erase the shop's data: its
      // catalog. Shopper fittings are not tied to Shopify customers.
      await supabase.from('garment_cad_profiles').delete().eq('tenant_id', tenantId);
      break;
    }
    case 'customers/data_request':
    case 'customers/redact':
      // Ashrium stores no Shopify customer data: shopper photos are deleted
      // after each fitting and fittings are not linked to customer records.
      break;
    default:
      // products/create and products/update are not acted on here yet;
      // Sync catalog picks up new and changed products.
      break;
  }

  return new Response(null, { status: 200 });
}
