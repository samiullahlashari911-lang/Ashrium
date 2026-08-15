'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavigationItem {
  href: string;
  label: string;
}

const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  { href: '/sandbox', label: '🥼 3D Sandbox' },
  { href: '/settings', label: '📊 Usage & Quotas' },
  { href: '/settings/integrations', label: '🔑 GPU Integrations' },
];

function isActivePath(pathname: string, href: string): boolean {
  return href === '/settings'
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardNavigation() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl">
      <nav
        aria-label="Dashboard navigation"
        className="mx-auto flex w-full max-w-7xl items-center gap-4 px-6 py-4"
      >
        <Link href="/sandbox" className="mr-auto text-lg font-bold tracking-tight text-slate-100">
          Ashrium
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-1">
          {NAVIGATION_ITEMS.map((item) => {
            const isActive = isActivePath(pathname, item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={[
                  'relative rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                  isActive
                    ? 'bg-sky-500/15 text-sky-100'
                    : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100',
                ].join(' ')}
              >
                {item.label}
                {isActive ? (
                  <span className="absolute inset-x-3 -bottom-1 h-0.5 rounded-full bg-sky-400" />
                ) : null}
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
