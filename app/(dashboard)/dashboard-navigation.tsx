'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { AshriumWordmark } from '@/components/brand/ashrium-logo';

interface NavigationItem {
  href: string;
  label: string;
}

const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  { href: '/merchant/dashboard', label: 'Dashboard' },
  { href: '/dashboard/garments', label: 'Garments' },
  { href: '/sandbox', label: '3D Sandbox' },
  { href: '/settings', label: 'Settings' },
  { href: '/settings/integrations', label: 'Integrations' },
  { href: '/onboarding', label: 'Setup' },
];

function isActivePath(pathname: string, href: string): boolean {
  return href === '/settings'
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardNavigation() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-obsidian-canvas/55 backdrop-blur-xl">
      <nav
        aria-label="Dashboard navigation"
        className="mx-auto flex w-full max-w-7xl items-center gap-4 px-6 py-4"
      >
        <Link href="/merchant/dashboard" className="mr-auto">
          <AshriumWordmark
            markClassName="h-8 w-8 shrink-0"
            wordClassName="text-lg font-bold tracking-tight text-obsidian-ink"
          />
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
                  'relative rounded-full px-3 py-2 text-sm font-semibold transition-colors',
                  isActive
                    ? 'bg-obsidian-accent/20 text-white'
                    : 'text-obsidian-muted hover:bg-white/5 hover:text-obsidian-ink',
                ].join(' ')}
              >
                {item.label}
                {isActive ? (
                  <span className="absolute inset-x-3 -bottom-1 h-0.5 rounded-full bg-gradient-to-r from-obsidian-accent to-obsidian-accent-end" />
                ) : null}
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
