export const MERCHANT_HOME_PATH = '/merchant/dashboard';
export const ONBOARDING_PATH = '/onboarding';
export const MAX_ALLOWED_DOMAINS = 50;

const PLACEHOLDER_MERCHANT_DOMAIN_PATTERN =
  /^tenant-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.internal$/i;

export function tenantNeedsOnboarding(
  allowedDomains: readonly string[] | null | undefined,
): boolean {
  return !allowedDomains || allowedDomains.length === 0;
}

export function merchantPostAuthPath(
  nextPath: string,
  needsOnboarding: boolean,
): string {
  if (nextPath === MERCHANT_HOME_PATH && needsOnboarding) {
    return ONBOARDING_PATH;
  }

  return nextPath;
}

export function isPlaceholderMerchantDomain(domain: string): boolean {
  return PLACEHOLDER_MERCHANT_DOMAIN_PATTERN.test(domain.trim());
}

export function parseStorefrontOrigin(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 256) {
    return null;
  }

  if (/[\s*]/.test(trimmed) || trimmed.includes('@')) {
    return null;
  }

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }

    if (url.username || url.password || url.origin === 'null') {
      return null;
    }

    const hostname = url.hostname.trim().toLowerCase();
    if (!hostname || hostname === 'null') {
      return null;
    }

    const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1';
    if (!isLoopback && !hostname.includes('.')) {
      return null;
    }

    if (isPlaceholderMerchantDomain(hostname)) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

export function parseStorefrontOriginList(rawInputs: readonly string[]): {
  invalid: string[];
  origins: string[];
} {
  const origins: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const raw of rawInputs) {
    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }

    const origin = parseStorefrontOrigin(trimmed);
    if (!origin) {
      invalid.push(trimmed);
      continue;
    }

    if (seen.has(origin)) {
      continue;
    }

    seen.add(origin);
    origins.push(origin);
  }

  return { invalid, origins };
}

export function mergeStorefrontOrigins(
  existing: readonly string[],
  incoming: readonly string[],
): string[] {
  return parseStorefrontOriginList([...existing, ...incoming]).origins.slice(0, MAX_ALLOWED_DOMAINS);
}

export function merchantDomainFromOrigins(origins: readonly string[]): string | null {
  for (const origin of origins) {
    try {
      const hostname = new URL(origin).hostname.trim().toLowerCase();
      if (hostname && !isPlaceholderMerchantDomain(hostname)) {
        return hostname;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export const STOREFRONT_APP_EMBED_NAME = 'Ashrium Try On';
export const STOREFRONT_APP_EMBED_INSTRUCTIONS =
  'Theme settings → App embeds → enable “Ashrium Try On”. Set the Ashrium platform URL to this app origin. Do not also add the “Virtual fitting room” section block unless the embed cannot find Add to cart.';

export type StorefrontGoLiveItemId =
  | 'shopify'
  | 'allowlist'
  | 'shop-origin'
  | 'custom-origin'
  | 'garment';

export interface StorefrontGoLiveItem {
  complete: boolean;
  detail: string;
  id: StorefrontGoLiveItemId;
  required: boolean;
  title: string;
}

export interface StorefrontGoLiveStatus {
  embedInstructions: string;
  items: StorefrontGoLiveItem[];
  platformUrl: string;
  ready: boolean;
  widgetAvailableUrl: string;
}

export function shopDomainOrigin(shopDomain: string | null | undefined): string | null {
  if (!shopDomain) {
    return null;
  }

  return parseStorefrontOrigin(shopDomain);
}

function originHostname(origin: string): string | null {
  try {
    return new URL(origin).hostname.trim().toLowerCase();
  } catch {
    return null;
  }
}

export function isMyshopifyHostname(hostname: string): boolean {
  return hostname.toLowerCase().endsWith('.myshopify.com');
}

export function evaluateStorefrontGoLive(input: {
  allowedDomains: readonly string[] | null | undefined;
  garmentCount: number;
  platformUrl: string;
  shopDomain: string | null;
  shopifyConnected: boolean;
}): StorefrontGoLiveStatus {
  const allowed = input.allowedDomains ?? [];
  const platformUrl = input.platformUrl.trim().replace(/\/$/, '');
  const shopOrigin = shopDomainOrigin(input.shopDomain);
  const hasAllowlist = allowed.length > 0;
  const hasShopOrigin = Boolean(shopOrigin && allowed.includes(shopOrigin));
  const hasCustomOrigin = allowed.some((origin) => {
    const hostname = originHostname(origin);
    return hostname !== null && !isMyshopifyHostname(hostname);
  });

  const items: StorefrontGoLiveItem[] = [
    {
      id: 'shopify',
      required: true,
      complete: input.shopifyConnected,
      title: 'Connect Shopify',
      detail: input.shopifyConnected && input.shopDomain
        ? `Connected to ${input.shopDomain}.`
        : 'Authorize Ashrium VFR with read_products in Settings → Integrations.',
    },
    {
      id: 'allowlist',
      required: true,
      complete: hasAllowlist,
      title: 'Allow shopper origins',
      detail: hasAllowlist
        ? `${allowed.length} origin${allowed.length === 1 ? '' : 's'} on the widget allowlist.`
        : 'Add every HTTPS origin shoppers use, including www and apex.',
    },
    {
      id: 'shop-origin',
      required: input.shopifyConnected,
      complete: !input.shopifyConnected || hasShopOrigin,
      title: 'Allow the Shopify shop domain',
      detail: shopOrigin
        ? hasShopOrigin
          ? `${shopOrigin} is allowlisted.`
          : `Add ${shopOrigin} so the myshopify storefront can mint a widget token.`
        : 'Connect Shopify so we can check the shop domain.',
    },
    {
      id: 'custom-origin',
      required: false,
      complete: hasCustomOrigin,
      title: 'Allow the custom storefront domain',
      detail: hasCustomOrigin
        ? 'A non-myshopify origin is on the allowlist.'
        : 'If shoppers use a custom domain, add https://brand.com and https://www.brand.com. Sandbox does not cover this.',
    },
    {
      id: 'garment',
      required: true,
      complete: input.garmentCount > 0,
      title: 'Ingest at least one SKU',
      detail: input.garmentCount > 0
        ? `${input.garmentCount} garment${input.garmentCount === 1 ? '' : 's'} in the library.`
        : 'Use Test this SKU on Garments. Try On stays hidden until the PDP handle or SKU matches.',
    },
  ];

  return {
    ready: items.filter((item) => item.required).every((item) => item.complete),
    items,
    platformUrl,
    widgetAvailableUrl: platformUrl ? `${platformUrl}/api/v1/widget/available` : '/api/v1/widget/available',
    embedInstructions: STOREFRONT_APP_EMBED_INSTRUCTIONS,
  };
}
