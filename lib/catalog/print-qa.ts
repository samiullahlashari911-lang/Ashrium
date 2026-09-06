import {
  PRINT_QA_MAX_BYTES,
  evaluatePrintQaFromBytes,
  failedPrintQa,
  type PrintQaResult,
} from '@/lib/graphics/print-qa';

const FETCH_TIMEOUT_MS = 8_000;

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return true;
  }

  if (host === '::1' || host === '[::1]' || host === '0.0.0.0') {
    return true;
  }

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) {
    return false;
  }

  const parts = ipv4.slice(1, 5).map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;
  return (
    a === 10
    || a === 127
    || a === 0
    || (a === 169 && b === 254)
    || (a === 192 && b === 168)
    || (a === 172 && b >= 16 && b <= 31)
  );
}

export function isPublicAlbedoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') {
      return false;
    }

    return !isBlockedHostname(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Ingest-time print QA. Fetches the product image and checks that it is a
 * real, sufficiently large picture. Pixel sampling (skin vs fabric) runs on
 * the client when the texture loads.
 */
export async function evaluatePrintAlbedoUrl(url: string | null | undefined): Promise<PrintQaResult> {
  const trimmed = url?.trim() ?? '';
  if (trimmed.length === 0) {
    return failedPrintQa('missing_url');
  }

  if (!isPublicAlbedoUrl(trimmed)) {
    return failedPrintQa('blocked_url');
  }

  try {
    const response = await fetch(trimmed, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'image/*,*/*;q=0.8' },
    });
    if (!response.ok) {
      return failedPrintQa('fetch_failed');
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType.length > 0 && !contentType.startsWith('image/') && !contentType.includes('octet-stream')) {
      return failedPrintQa('not_image');
    }

    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > PRINT_QA_MAX_BYTES) {
      return failedPrintQa('too_large');
    }

    return evaluatePrintQaFromBytes(buffer);
  } catch {
    return failedPrintQa('fetch_failed');
  }
}
