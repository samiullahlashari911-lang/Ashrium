import { NextResponse, type NextRequest } from 'next/server';

import {
  MERCHANT_HOME_PATH,
  merchantPostAuthPath,
  tenantNeedsOnboarding,
} from '@/lib/onboarding';
import { createClient } from '@/lib/supabase/server';
import {
  merchantPortalSignInPath,
  readMerchantPortalAccess,
} from '@/lib/supabase/merchant-access';

const DEFAULT_NEXT_PATH = MERCHANT_HOME_PATH;

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

  const access = await readMerchantPortalAccess(supabase);
  if (!access.allowed) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL(merchantPortalSignInPath(access.reason), request.url));
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('allowed_domains')
    .eq('id', access.tenantId)
    .maybeSingle();
  const destination = merchantPostAuthPath(
    nextPath,
    tenantNeedsOnboarding(tenant?.allowed_domains),
  );

  return NextResponse.redirect(new URL(destination, request.url));
}
