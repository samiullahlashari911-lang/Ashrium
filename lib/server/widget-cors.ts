const WIDGET_API_PREFIX = '/api/v1/widget';

export function isWidgetApiPath(pathname: string): boolean {
  return pathname === WIDGET_API_PREFIX || pathname.startsWith(`${WIDGET_API_PREFIX}/`);
}

export function isWidgetPreflightOrigin(origin: string | null): origin is string {
  if (!origin) {
    return false;
  }

  try {
    const url = new URL(origin);
    return (
      url.protocol === 'https:'
      && !url.username
      && !url.password
      && url.origin === origin
    );
  } catch {
    return false;
  }
}

function isLocalDevelopmentOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function resolveApiCorsOrigin(input: {
  configuredOrigins: readonly string[];
  isDevelopment: boolean;
  origin: string | null;
  pathname: string;
  requestOrigin: string;
}): string | null {
  const origin = input.origin;
  if (!origin) {
    return null;
  }

  if (isWidgetApiPath(input.pathname) && isWidgetPreflightOrigin(origin)) {
    return origin;
  }

  if (origin === input.requestOrigin) {
    return origin;
  }

  if (input.configuredOrigins.includes(origin)) {
    return origin;
  }

  if (input.isDevelopment && isLocalDevelopmentOrigin(origin)) {
    return origin;
  }

  return null;
}
