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
