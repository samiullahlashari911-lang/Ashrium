import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { DashboardNavigation } from '@/app/(dashboard)/dashboard-navigation';
import { ThemeShell } from '@/components/theme/atmosphere-backdrop';
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

  return (
    <ThemeShell intensity="subtle" surface="dashboard">
      <DashboardNavigation />
      {children}
    </ThemeShell>
  );
}
