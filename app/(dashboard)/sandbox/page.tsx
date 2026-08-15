import { redirect } from 'next/navigation';

import { StorefrontSandbox } from '@/app/(dashboard)/sandbox/storefront-sandbox';
import { createWidgetEmbedToken } from '@/lib/server/widget-embed';
import { getCurrentTenantId } from '@/lib/supabase/tenant';

export const dynamic = 'force-dynamic';

export default async function SandboxPage() {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    redirect('/sign-in');
  }

  return <StorefrontSandbox token={createWidgetEmbedToken(tenantId)} />;
}
