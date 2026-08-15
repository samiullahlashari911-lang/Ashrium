import { GarmentsWorkspace } from '@/components/dashboard/garments-workspace';
import { listGarmentProfiles } from '@/lib/server/garments';
import { getCurrentTenantId } from '@/lib/supabase/tenant';

export const dynamic = 'force-dynamic';

export default async function GarmentsDashboardPage() {
  const tenantId = await getCurrentTenantId();

  if (!tenantId) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center p-6">
        <div className="rounded-xl border border-amber-700/50 bg-amber-950/30 p-6">
          <h1 className="text-xl font-semibold text-amber-100">Tenant Authentication Required</h1>
          <p className="mt-2 text-sm text-amber-200/90">
            Sign in with a Supabase user whose JWT contains{' '}
            <code className="rounded bg-slate-900 px-1 py-0.5">app_metadata.tenant_id</code>{' '}
            to manage CAD garment profiles under Row Level Security.
          </p>
        </div>
      </main>
    );
  }

  const profiles = await listGarmentProfiles();

  return (
    <main className="min-h-screen">
      <GarmentsWorkspace initialProfiles={profiles} />
    </main>
  );
}
