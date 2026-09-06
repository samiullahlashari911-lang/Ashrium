'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';

import { EmptyState } from '@/components/dashboard/empty-state';
import { MAX_ALLOWED_DOMAINS, parseStorefrontOrigin } from '@/lib/onboarding';
import { replaceAllowedDomains } from '@/lib/server/tenant-settings';

export interface DomainAllowlistFormProps {
  initialDomains: string[];
}

export function DomainAllowlistForm({
  initialDomains,
}: DomainAllowlistFormProps): React.JSX.Element {
  const router = useRouter();
  const [domains, setDomains] = useState<string[]>(initialDomains);
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [isPending, startTransition] = useTransition();

  const persist = (nextDomains: string[]): void => {
    setMessage('');
    setIsError(false);

    startTransition(async () => {
      const result = await replaceAllowedDomains(nextDomains);
      setMessage(result.message);
      setIsError(!result.success);
      if (result.success) {
        setDomains(result.domains);
        router.refresh();
      }
    });
  };

  const handleAdd = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const origin = parseStorefrontOrigin(draft);
    if (!origin) {
      setIsError(true);
      setMessage('Enter a storefront origin such as https://brand.myshopify.com.');
      return;
    }

    if (domains.includes(origin)) {
      setIsError(true);
      setMessage('That origin is already on the allowlist.');
      return;
    }

    if (domains.length >= MAX_ALLOWED_DOMAINS) {
      setIsError(true);
      setMessage(`At most ${MAX_ALLOWED_DOMAINS} storefront origins can be allowlisted.`);
      return;
    }

    setDraft('');
    persist([...domains, origin]);
  };

  const handleRemove = (origin: string): void => {
    persist(domains.filter((item) => item !== origin));
  };

  return (
    <section className="obsidian-glass p-6">
      <header className="border-b border-white/10 pb-4">
        <h2 className="text-lg font-semibold text-obsidian-ink">Storefront domain allowlist</h2>
        <p className="mt-1 text-sm text-obsidian-muted">
          Only these origins can mint a widget embed token. Use the exact storefront origin,
          including https.
        </p>
      </header>

      {domains.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            title="No storefront origins yet"
            description="Add your Shopify storefront or custom domain so Try On can load on the product page."
          />
        </div>
      ) : (
        <ul className="mt-5 flex flex-col gap-2">
          {domains.map((origin) => (
            <li
              key={origin}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-obsidian-canvas/50 px-4 py-3"
            >
              <span className="font-mono text-sm text-obsidian-ink">{origin}</span>
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleRemove(origin)}
                className="rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-obsidian-muted transition hover:border-obsidian-tension hover:text-obsidian-tension-muted disabled:opacity-60"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm font-medium text-obsidian-ink">
          Add origin
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            autoComplete="off"
            placeholder="https://brand.myshopify.com"
            className="obsidian-input-box font-mono text-sm"
          />
        </label>
        <button type="submit" disabled={isPending} className="obsidian-cta shrink-0">
          {isPending ? 'Saving…' : 'Add origin'}
        </button>
      </form>

      {message ? (
        <p className={`mt-4 text-sm ${isError ? 'text-rose-300' : 'text-emerald-300'}`}>{message}</p>
      ) : null}
    </section>
  );
}
