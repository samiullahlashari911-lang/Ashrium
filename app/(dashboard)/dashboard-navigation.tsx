'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { AshriumWordmark } from '@/components/brand/ashrium-logo';

interface NavigationItem {
  href: string;
  label: string;
  /** 24×24 stroke icon path. */
  icon: string;
}

const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  { href: '/merchant/dashboard', label: 'Dashboard', icon: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z' },
  { href: '/dashboard/garments', label: 'Garments', icon: 'M12 6a2 2 0 1 0-2-2M12 6v2m0 0L3.5 14.2A1.5 1.5 0 0 0 4.4 17h15.2a1.5 1.5 0 0 0 .9-2.8z' },
  { href: '/sandbox', label: '3D Sandbox', icon: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5' },
  { href: '/settings', label: 'Settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' },
  { href: '/settings/integrations', label: 'Integrations', icon: 'M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5' },
  { href: '/onboarding', label: 'Setup', icon: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9' },
];

function isActivePath(pathname: string, href: string): boolean {
  return href === '/settings'
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

function NavIcon({ path }: { path: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Left rail on desktop (reference board admin), a scrollable top bar on
 * phones. Solid surfaces only — no backdrop blur on the dashboard.
 */
export function DashboardNavigation() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-ash-line bg-ash-surface md:h-screen md:w-60 md:shrink-0 md:border-b-0 md:border-r">
      <nav
        aria-label="Dashboard navigation"
        className="flex items-center gap-3 px-4 py-3 md:h-full md:flex-col md:items-stretch md:gap-1 md:px-3 md:py-5"
      >
        <Link href="/merchant/dashboard" className="mr-2 shrink-0 md:mb-6 md:mr-0 md:px-3">
          <AshriumWordmark
            markClassName="h-7 w-7 shrink-0 text-ash-accent"
            wordClassName="hidden text-base font-semibold tracking-tight text-ash-ink sm:inline"
          />
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto md:flex-none md:flex-col md:items-stretch md:overflow-visible">
          {NAVIGATION_ITEMS.map((item) => {
            const isActive = isActivePath(pathname, item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={[
                  'flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
                  isActive
                    ? 'bg-ash-accent-soft text-ash-accent'
                    : 'text-ash-muted hover:bg-ash-raised hover:text-ash-ink',
                ].join(' ')}
              >
                <NavIcon path={item.icon} />
                <span className="whitespace-nowrap">{item.label}</span>
              </Link>
            );
          })}
        </div>
        <p className="mt-auto hidden px-3 text-[11px] leading-relaxed text-ash-subtle md:block">
          Shopper photos are deleted within 15 minutes. Nothing here shows a face.
        </p>
      </nav>
    </header>
  );
}
