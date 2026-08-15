import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const API_PREFIX = '/api/v1/';
const WIDGET_IFRAME_PATHS = new Set(['/widget/embed', '/widget/vfr']);

function isStandaloneMerchantPath(pathname: string): boolean {
  return pathname === '/merchant' || pathname.startsWith('/merchant/');
}

function getRequiredPublicEnv(): { anonKey: string; url: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  return url && anonKey ? { anonKey, url } : null;
}

function getConfiguredOrigins(): string[] {
  return (process.env.ASHRIUM_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function isLocalDevelopmentOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function isAllowedCorsOrigin(request: NextRequest, origin: string | null): origin is string {
  if (!origin) {
    return false;
  }

  return (
    origin === request.nextUrl.origin
    || getConfiguredOrigins().includes(origin)
    || (process.env.NODE_ENV === 'development' && isLocalDevelopmentOrigin(origin))
  );
}

function applySecurityHeaders(response: NextResponse, pathname: string): void {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (!WIDGET_IFRAME_PATHS.has(pathname)) {
    response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  }
}

function applyCorsHeaders(response: NextResponse, origin: string): void {
  response.headers.set('Access-Control-Allow-Origin', origin);
  response.headers.set('Access-Control-Allow-Credentials', 'true');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.headers.set(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-Ashrium-Signature, X-Ashrium-Tenant-Id, X-Ashrium-Timestamp',
  );
  response.headers.set('Access-Control-Max-Age', '600');
  response.headers.set('Vary', 'Origin');
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;
  const origin = request.headers.get('origin');
  const isApiRequest = pathname.startsWith(API_PREFIX);

  if (isStandaloneMerchantPath(pathname) && process.env.NODE_ENV === 'development') {
    const response = NextResponse.next({ request });
    applySecurityHeaders(response, pathname);
    return response;
  }

  if (isApiRequest && request.method === 'OPTIONS') {
    const response = new NextResponse(null, {
      status: isAllowedCorsOrigin(request, origin) ? 204 : 403,
    });
    applySecurityHeaders(response, pathname);

    if (isAllowedCorsOrigin(request, origin)) {
      applyCorsHeaders(response, origin);
    }

    return response;
  }

  const env = getRequiredPublicEnv();

  if (!env) {
    const response = NextResponse.next({ request });
    applySecurityHeaders(response, pathname);

    if (isApiRequest && isAllowedCorsOrigin(request, origin)) {
      applyCorsHeaders(response, origin);
    }

    return response;
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });

        Object.entries(headers).forEach(([name, value]) => {
          response.headers.set(name, value);
        });
      },
    },
  });

  await supabase.auth.getUser();
  applySecurityHeaders(response, pathname);

  if (isApiRequest && isAllowedCorsOrigin(request, origin)) {
    applyCorsHeaders(response, origin);
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|merchant).*)',
  ],
};
