'use client';

import { useState, useTransition, type FC, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface CatalogSyncBarProps {
  connected: boolean;
  shopDomain: string | null;
}

interface SyncResponse {
  imported?: number;
  updated?: number;
  skipped?: number;
  errors?: Array<{ sku: string; message: string }>;
  code?: string;
  message?: string;
}

function formatSyncMessage(payload: SyncResponse): string {
  const errorCount = payload.errors?.length ?? 0;
  return `Imported ${payload.imported ?? 0}, updated ${payload.updated ?? 0}, skipped ${payload.skipped ?? 0}${errorCount > 0 ? `, ${errorCount} failed` : ''}.`;
}

export const CatalogSyncBar: FC<CatalogSyncBarProps> = ({ connected, shopDomain }) => {
  const router = useRouter();
  const [selector, setSelector] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [isError, setIsError] = useState<boolean>(false);
  const [isPending, startTransition] = useTransition();

  const failFromPayload = (payload: SyncResponse): void => {
    setIsError(true);
    if (payload.code === 'SHOPIFY_NOT_CONNECTED') {
      setMessage(
        'Add the shop domain and Admin API token in Settings → Integrations before testing a SKU.',
      );
      return;
    }
    if (payload.code === 'SHOPIFY_SCOPE_DENIED') {
      setMessage(
        payload.message
          ?? 'Shopify denied products access. Grant read_products on the custom app, then reconnect in Settings → Integrations.',
      );
      return;
    }
    if (payload.code === 'SHOPIFY_AUTH_FAILED') {
      setMessage('Shopify rejected the stored Admin token. Update it in Settings → Integrations.');
      return;
    }
    setMessage(payload.message ?? 'Catalog sync failed.');
  };

  const runSync = (body: string | undefined): void => {
    setMessage('');
    setIsError(false);

    startTransition(async () => {
      try {
        const response = await fetch('/api/v1/catalog/sync', {
          method: 'POST',
          credentials: 'same-origin',
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body,
        });
        const payload = (await response.json()) as SyncResponse;

        if (!response.ok) {
          failFromPayload(payload);
          return;
        }

        setMessage(formatSyncMessage(payload));
        router.refresh();
      } catch {
        setIsError(true);
        setMessage('Unable to reach catalog sync.');
      }
    });
  };

  const handleTestSku = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const value = selector.trim();
    if (!value) {
      setIsError(true);
      setMessage('Paste a product URL, product ID, variant ID, or SKU.');
      return;
    }

    runSync(JSON.stringify({ selector: value }));
  };

  return (
    <section className="obsidian-glass flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-obsidian-ink">Test one SKU</h2>
          <p className="mt-1 text-sm text-obsidian-muted">
            {connected && shopDomain
              ? `Connected to ${shopDomain}. Ingest a single product — not the whole catalog — then map KES and grade rest lengths.`
              : 'Add the shop domain and Admin API token in Settings → Integrations. Do not paste secrets here.'}
          </p>
        </div>
        {!connected ? (
          <Link
            href="/settings/integrations"
            className="obsidian-cta inline-flex shrink-0 items-center justify-center no-underline"
          >
            Connect Shopify
          </Link>
        ) : null}
      </div>

      {connected ? (
        <form onSubmit={handleTestSku} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm font-medium text-obsidian-ink">
            Product URL, ID, variant ID, or SKU
            <input
              value={selector}
              onChange={(event) => setSelector(event.target.value)}
              placeholder="https://brand.myshopify.com/products/essential-tee"
              autoComplete="off"
              spellCheck={false}
              className="obsidian-input-box font-mono text-sm"
            />
          </label>
          <button type="submit" disabled={isPending} className="obsidian-cta shrink-0 disabled:cursor-not-allowed">
            {isPending ? 'Testing…' : 'Test this SKU'}
          </button>
        </form>
      ) : null}

      {message ? (
        <p className={`text-sm ${isError ? 'text-red-400' : 'text-emerald-400'}`}>{message}</p>
      ) : null}

      {connected ? (
        <div className="border-t border-white/10 pt-3">
          <button
            type="button"
            onClick={() => runSync(undefined)}
            disabled={isPending}
            className="text-sm text-obsidian-muted underline-offset-2 hover:text-obsidian-ink hover:underline disabled:cursor-not-allowed"
          >
            Sync full catalog instead
          </button>
        </div>
      ) : null}
    </section>
  );
};
