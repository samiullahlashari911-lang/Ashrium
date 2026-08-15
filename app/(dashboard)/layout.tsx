import type { ReactNode } from 'react';

import { DashboardNavigation } from '@/app/(dashboard)/dashboard-navigation';

export default function DashboardLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="min-h-screen bg-slate-950">
      <DashboardNavigation />
      {children}
    </div>
  );
}
