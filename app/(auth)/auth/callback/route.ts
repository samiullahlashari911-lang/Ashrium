import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';

const DEFAULT_NEXT_PATH = '/merchant/dashboard';

function getSafeNextPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return DEFAULT_NEXT_PATH;
  }

  return value;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const code = request.nextUrl.searchParams.get('code');
  const nextPath = getSafeNextPath(request.nextUrl.searchParams.get('next'));

  if (!code) {
    const signInUrl = new URL('/sign-in', request.url);
    signInUrl.searchParams.set('error', 'missing_auth_code');
    return NextResponse.redirect(signInUrl);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const signInUrl = new URL('/sign-in', request.url);
    signInUrl.searchParams.set('error', 'auth_callback_failed');
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.redirect(new URL(nextPath, request.url));
}
