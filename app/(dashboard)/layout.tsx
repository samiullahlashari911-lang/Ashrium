import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { DashboardNavigation } from '@/app/(dashboard)/dashboard-navigation';
import { StorefrontGoLiveBanner } from '@/components/dashboard/storefront-golive-banner';
import { ThemeShell } from '@/components/theme/atmosphere-backdrop';
import { loadStorefrontGoLiveStatus } from '@/lib/server/storefront-golive';
import { createClient } from '@/lib/supabase/server';
import {
  merchantPortalSignInPath,
  readMerchantPortalAccess,
} from '@/lib/supabase/merchant-access';

export default async function DashboardLayout({ children }: Readonly<{ children: ReactNode }>) {
  const supabase = await createClient();
  const access = await readMerchantPortalAccess(supabase);

  if (!access.allowed) {
    if (access.reason !== 'unauthenticated') {
      await supabase.auth.signOut();
    }

    redirect(merchantPortalSignInPath(access.reason));
  }

  let goLiveStatus = null;
  try {
    goLiveStatus = await loadStorefrontGoLiveStatus(access.tenantId);
  } catch {
    goLiveStatus = null;
  }

  return (
    <ThemeShell intensity="subtle" surface="dashboard">
      <DashboardNavigation />
      {goLiveStatus ? <StorefrontGoLiveBanner status={goLiveStatus} /> : null}
      {children}
    </ThemeShell>
  );
}
