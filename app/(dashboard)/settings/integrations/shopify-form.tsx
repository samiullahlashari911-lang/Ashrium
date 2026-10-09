'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FC,
  type FormEvent,
} from 'react';

import {
  disconnectShopifyIntegration,
  saveShopifyIntegration,
} from '@/lib/server/shopify-actions';

export interface ShopifyFormProps {
  connected: boolean;
  shopDomain: string | null;
  usesOAuth: boolean;
  /** The client's own app install link; replaces the shop-domain OAuth form. */
  installUrl?: string | null;
}

function readOAuthMessage(searchParams: URLSearchParams): { message: string; isError: boolean } | null {
  const outcome = searchParams.get('shopify');
  const message = searchParams.get('message')?.trim();

  if (!outcome || !message) {
    return null;
  }

  return {
    message,
    isError: outcome === 'error',
  };
}

export const ShopifyForm: FC<ShopifyFormProps> = ({ connected, shopDomain, usesOAuth, installUrl = null }) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const domainRef = useRef<HTMLInputElement | null>(null);
  const tokenRef = useRef<HTMLInputElement | null>(null);
  const oauthMessage = readOAuthMessage(searchParams);
  const [message, setMessage] = useState<string>(
    oauthMessage?.message
      ?? (connected && shopDomain ? `Connected to ${shopDomain}.` : ''),
  );
  const [isError, setIsError] = useState<boolean>(oauthMessage?.isError ?? false);
  const [showManualToken, setShowManualToken] = useState<boolean>(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!oauthMessage) {
      return;
    }

    router.replace('/settings/integrations', { scroll: false });
  }, [oauthMessage, router]);

  const handleManualSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const domain = domainRef.current?.value ?? '';
    const token = tokenRef.current?.value ?? '';
    setMessage('');
    setIsError(false);

    startTransition(async () => {
      const result = await saveShopifyIntegration(domain, token);
      setMessage(result.message);
      setIsError(!result.success);
      if (result.success && tokenRef.current) {
        tokenRef.current.value = '';
        router.refresh();
      }
    });
  };

  const handleDisconnect = (): void => {
    setMessage('');
    setIsError(false);

    startTransition(async () => {
      const result = await disconnectShopifyIntegration();
      setMessage(result.message);
      setIsError(!result.success);
      if (result.success) {
        router.refresh();
      }
    });
  };

  const handleConnect = (): void => {
    if (installUrl) {
      window.location.assign(installUrl);
      return;
    }
    const domain = domainRef.current?.value ?? shopDomain ?? '';
    const params = new URLSearchParams({
      shop: domain,
      return_to: '/settings/integrations',
    });
    window.location.assign(`/api/v1/shopify/oauth/start?${params.toString()}`);
  };

  return (
    <section className="ash-card p-6">
      <div className="border-b border-ash-line pb-4">
        <h2 className="text-lg font-semibold text-ash-ink">Shopify Admin</h2>
        {installUrl ? (
          <p className="mt-1 text-sm text-ash-muted">
            Connect opens Shopify so you can approve Ashrium on{' '}
            <span className="font-mono text-xs">{shopDomain}</span>. Ashrium only reads your
            products, keeps the access encrypted on our servers, and never shares it with the
            storefront widget.
          </p>
        ) : (
          <>
          <p className="mt-1 text-sm text-ash-muted">
            Connect once with the Ashrium VFR Partner app. Ashrium stores an encrypted offline Admin
            API token server-side and refreshes it when needed. The widget never receives these
            credentials. Required scope:{' '}
            <span className="font-mono text-xs">read_products</span>.
          </p>
          <p className="mt-2 text-sm text-ash-muted">
            In the Shopify Dev Dashboard, whitelist your OAuth redirect URL to match{' '}
            <span className="font-mono text-xs">APP_BASE_URL/api/v1/shopify/oauth/callback</span>{' '}
            (or set <span className="font-mono text-xs">SHOPIFY_OAUTH_REDIRECT_URI</span> explicitly).
          </p>
          </>
        )}
      </div>

      {installUrl ? null : (
        <label className="mt-5 flex flex-col gap-2 text-sm font-medium text-ash-ink">
          Shop domain
          <input
            ref={domainRef}
            required
            name="shopifyShopDomain"
            autoComplete="off"
            spellCheck={false}
            defaultValue={shopDomain ?? ''}
            placeholder="brand.myshopify.com"
            className="ash-input-box font-mono text-sm"
          />
        </label>
      )}

      {connected && shopDomain ? (
        <div className="mt-4 rounded-xl border border-ash-success/30 bg-ash-success-soft px-4 py-3 text-sm text-ash-success">
          <p>
            Connected to <span className="font-mono">{shopDomain}</span>
            {usesOAuth ? ' via OAuth.' : ' via manual token.'}
          </p>
          <p className="mt-1 text-ash-success">
            Test one SKU on Garments — full catalog sync is optional.
          </p>
        </div>
      ) : null}

      {message ? (
        <p className={`mt-4 text-sm ${isError ? 'text-ash-tension' : 'text-ash-success'}`}>{message}</p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={handleConnect} className="ash-cta">
          {connected ? 'Reconnect Shopify' : 'Connect Shopify'}
        </button>
        {connected ? (
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={isPending}
            className="rounded-full border border-ash-line px-5 py-3 text-sm font-semibold text-ash-ink transition hover:border-ash-tension/30 hover:bg-ash-tension-soft disabled:opacity-60"
          >
            {isPending ? 'Disconnecting…' : 'Disconnect'}
          </button>
        ) : null}
      </div>

      {installUrl ? null : (
        <details
          className="mt-6 rounded-xl border border-ash-line bg-ash-raised p-4"
          open={showManualToken}
          onToggle={(event) => setShowManualToken(event.currentTarget.open)}
        >
          <summary className="cursor-pointer text-sm font-medium text-ash-ink">
            Advanced: paste Admin API token
          </summary>
          <p className="mt-3 text-sm text-ash-muted">
            Legacy fallback for custom apps or debugging. Prefer Connect Shopify for the Partner app
            flow with automatic token refresh.
          </p>
          <form onSubmit={handleManualSubmit} className="mt-4 flex flex-col gap-4">
            <label className="flex flex-col gap-2 text-sm font-medium text-ash-ink">
              Admin API access token
              <input
                ref={tokenRef}
                required
                type="password"
                name="shopifyAdminToken"
                autoComplete="off"
                spellCheck={false}
                placeholder="shpat_..."
                className="ash-input-box font-mono text-sm"
              />
            </label>
            <button type="submit" disabled={isPending} className="ash-cta self-start">
              {isPending ? 'Verifying…' : 'Save manual token'}
            </button>
          </form>
        </details>
      )}
    </section>
  );
};
