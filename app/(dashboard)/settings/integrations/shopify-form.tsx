'use client';

import { useRef, useState, useTransition, type FC, type FormEvent } from 'react';

import { saveShopifyIntegration } from '@/lib/server/shopify-actions';

export interface ShopifyFormProps {
  connected: boolean;
  shopDomain: string | null;
}

export const ShopifyForm: FC<ShopifyFormProps> = ({ connected, shopDomain }) => {
  const domainRef = useRef<HTMLInputElement | null>(null);
  const tokenRef = useRef<HTMLInputElement | null>(null);
  const [message, setMessage] = useState<string>(
    connected && shopDomain ? `Connected to ${shopDomain}.` : '',
  );
  const [isError, setIsError] = useState<boolean>(false);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
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
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="obsidian-glass p-6">
      <div className="border-b border-white/10 pb-4">
        <h2 className="text-lg font-semibold text-obsidian-ink">Shopify Admin</h2>
        <p className="mt-1 text-sm text-obsidian-muted">
          Store the shop domain and Admin API token server-side. The widget never receives these
          credentials. Required scopes: <span className="font-mono text-xs">read_products</span>.
          After connecting, test one SKU on Garments — full catalog sync is not required.
        </p>
      </div>

      <label className="mt-5 flex flex-col gap-2 text-sm font-medium text-obsidian-ink">
        Shop domain
        <input
          ref={domainRef}
          required
          name="shopifyShopDomain"
          autoComplete="off"
          spellCheck={false}
          defaultValue={shopDomain ?? ''}
          placeholder="brand.myshopify.com"
          className="obsidian-input-box font-mono text-sm"
        />
      </label>

      <label className="mt-4 flex flex-col gap-2 text-sm font-medium text-obsidian-ink">
        Admin API access token
        <input
          ref={tokenRef}
          required
          type="password"
          name="shopifyAdminToken"
          autoComplete="off"
          spellCheck={false}
          placeholder="shpat_..."
          className="obsidian-input-box font-mono text-sm"
        />
      </label>

      {message ? (
        <p className={`mt-4 text-sm ${isError ? 'text-red-300' : 'text-emerald-300'}`}>{message}</p>
      ) : null}

      <button type="submit" disabled={isPending} className="obsidian-cta mt-5">
        {isPending ? 'Verifying…' : connected ? 'Replace connection' : 'Connect Shopify'}
      </button>
    </form>
  );
};
