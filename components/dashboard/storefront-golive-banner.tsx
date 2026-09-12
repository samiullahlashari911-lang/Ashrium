'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { StorefrontGoLiveStatus } from '@/lib/onboarding';

export function StorefrontGoLiveBanner({
  status,
}: {
  status: StorefrontGoLiveStatus;
}): React.JSX.Element | null {
  const pathname = usePathname();
  const onOnboarding = pathname === '/onboarding' || pathname.startsWith('/onboarding/');
  const onSandbox = pathname === '/sandbox' || pathname.startsWith('/sandbox/');

  if (onOnboarding) {
    return null;
  }

  if (status.ready) {
    if (!onSandbox) {
      return null;
    }

    return (
      <aside className="border-b border-amber-500/25 bg-amber-500/10 px-6 py-3">
        <p className="mx-auto max-w-7xl text-sm text-amber-100">
          Sandbox is first-party on this app origin. It is not storefront go-live. Confirm Try On
          on the published product page after enabling App embeds → Ashrium Try On.
        </p>
      </aside>
    );
  }

  return (
    <aside className="border-b border-amber-500/30 bg-amber-500/10 px-6 py-4">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3">
        <div>
          <p className="text-sm font-semibold text-amber-50">Storefront is not live</p>
          <p className="mt-1 text-sm text-amber-100/90">
            Sandbox Try On does not count. Shoppers only see the button after Shopify, the
            allowlist, an ingested SKU, and the theme embed all match.
          </p>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {status.items.map((item) => (
            <li key={item.id} className="text-sm text-amber-50">
              <span className="font-semibold">
                {item.complete ? 'Done' : item.required ? 'Needed' : 'Recommended'}
                {': '}
                {item.title}
              </span>
              <span className="mt-0.5 block text-amber-100/80">{item.detail}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-amber-100/90">{status.embedInstructions}</p>
        {status.platformUrl ? (
          <p className="font-mono text-xs text-amber-50">
            Platform URL: {status.platformUrl}
          </p>
        ) : null}
        <p className="font-mono text-xs text-amber-50">
          Live probe: POST {status.widgetAvailableUrl} from the shopper origin with handle and sku.
        </p>
        <Link href="/onboarding" className="obsidian-cta self-start no-underline">
          Continue setup
        </Link>
      </div>
    </aside>
  );
}
