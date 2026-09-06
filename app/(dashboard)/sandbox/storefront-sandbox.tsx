'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { DebugGalleryUpload } from '@/components/widget/guided-capture/debug-gallery-upload';
import {
  ReplicateRuntimeBanner,
  type ReplicateRuntimeBannerConfig,
} from '@/components/dashboard/replicate-runtime-banner';

interface DemoProduct {
  name: string;
  price: string;
  sku: string;
}

interface EventLogEntry {
  direction: 'HOST_TO_WIDGET' | 'WIDGET_TO_HOST';
  id: number;
  payload: Record<string, unknown>;
  timestamp: string;
  type: string;
}

interface VfrWidgetController {
  setGarment: (sku: string, variantId?: string) => void;
  setUserParams: (params: Record<string, number>) => void;
}

interface SandboxWindow extends Window {
  __ASHRIUM_VFR_WIDGET__?: boolean;
  AshriumVfrWidget?: VfrWidgetController;
}

const DEMO_PRODUCTS: readonly DemoProduct[] = [
  { sku: 'SKU-DENIM-001', name: 'Structured Denim', price: '$89.00' },
  { sku: 'SKU-COTTON-002', name: 'Essential Cotton Tee', price: '$32.00' },
  { sku: 'SKU-KNIT-003', name: 'Merino Knit', price: '$118.00' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isWidgetMessage(value: unknown): value is {
  payload: Record<string, unknown>;
  type: string;
} {
  return isRecord(value)
    && value.source === 'ashrium-vfr'
    && typeof value.type === 'string'
    && isRecord(value.payload);
}

export function StorefrontSandbox({
  tenantId,
  token,
  replicate,
}: {
  tenantId: string;
  token: string;
  replicate: ReplicateRuntimeBannerConfig;
}): React.JSX.Element {
  const scriptMountRef = useRef<HTMLDivElement | null>(null);
  const nextLogIdRef = useRef(1);
  const [selectedSku, setSelectedSku] = useState(DEMO_PRODUCTS[0].sku);
  const [recommendedSize, setRecommendedSize] = useState<string | null>(null);
  const [widgetReady, setWidgetReady] = useState(false);
  const [events, setEvents] = useState<EventLogEntry[]>([]);

  const addEvent = useCallback(
    (
      direction: EventLogEntry['direction'],
      type: string,
      payload: Record<string, unknown>,
    ): void => {
      const entry: EventLogEntry = {
        direction,
        id: nextLogIdRef.current,
        payload,
        timestamp: new Date().toISOString(),
        type,
      };

      nextLogIdRef.current += 1;
      setEvents((currentEvents) => [entry, ...currentEvents].slice(0, 50));
    },
    [],
  );

  useEffect(() => {
    const sandboxWindow = window as SandboxWindow;
    const mount = scriptMountRef.current;
    if (!mount) {
      return;
    }

    const script = document.createElement('script');
    script.src = '/vfr-widget.js';
    script.async = true;
    script.dataset.embedToken = token;
    script.dataset.sku = DEMO_PRODUCTS[0].sku;
    mount.appendChild(script);

    const onWidgetMessage = (event: MessageEvent<unknown>): void => {
      if (event.origin !== window.location.origin || !isWidgetMessage(event.data)) {
        return;
      }

      addEvent('WIDGET_TO_HOST', event.data.type, event.data.payload);

      if (event.data.type === 'VFR_WIDGET_READY') {
        setWidgetReady(true);
      }

      if (event.data.type === 'VFR_SIZE_RECOMMENDED' && typeof event.data.payload.size === 'string') {
        setRecommendedSize(event.data.payload.size);
      }
    };

    window.addEventListener('message', onWidgetMessage);

    return () => {
      window.removeEventListener('message', onWidgetMessage);
      document.getElementById('vfr-widget-root')?.remove();
      script.remove();
      delete sandboxWindow.AshriumVfrWidget;
      delete sandboxWindow.__ASHRIUM_VFR_WIDGET__;
    };
  }, [addEvent, token]);

  useEffect(() => {
    if (!widgetReady) {
      return;
    }

    const controller = (window as SandboxWindow).AshriumVfrWidget;
    if (!controller) {
      return;
    }

    const payload = { sku: selectedSku };
    controller.setGarment(selectedSku);
    addEvent('HOST_TO_WIDGET', 'VFR_SET_GARMENT', payload);
  }, [addEvent, selectedSku, widgetReady]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 p-6">
      <header>
        <p className="text-sm font-medium text-obsidian-accent-muted">Storefront integration harness</p>
        <h1 className="mt-1 text-3xl font-bold text-obsidian-ink">Ashrium Outfitters</h1>
        <p className="mt-2 text-sm text-obsidian-muted">
          Simulate product changes and inspect the isolated widget event bridge.
        </p>
      </header>

      <ReplicateRuntimeBanner config={replicate} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="obsidian-glass p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-mono text-xs text-obsidian-accent-muted">{selectedSku}</p>
              <h2 className="mt-1 text-2xl font-semibold text-obsidian-ink">
                {DEMO_PRODUCTS.find((product) => product.sku === selectedSku)?.name}
              </h2>
            </div>
            <p className="text-lg font-semibold text-obsidian-ink">
              {DEMO_PRODUCTS.find((product) => product.sku === selectedSku)?.price}
            </p>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {DEMO_PRODUCTS.map((product) => (
              <button
                key={product.sku}
                type="button"
                onClick={() => setSelectedSku(product.sku)}
                className={[
                  'rounded-full border px-4 py-2 text-sm transition',
                  product.sku === selectedSku
                    ? 'border-obsidian-accent bg-obsidian-accent/20 text-obsidian-ink'
                    : 'border-white/10 bg-obsidian-canvas/50 text-obsidian-muted hover:border-white/25',
                ].join(' ')}
              >
                {product.name}
              </button>
            ))}
          </div>

          <div className="mt-6 rounded-xl border border-white/10 bg-obsidian-canvas/50 p-3">
            <div ref={scriptMountRef} />
          </div>

          <div className="mt-5 flex items-center gap-3">
            <span className="text-sm text-obsidian-muted">Recommended size</span>
            <span className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-3 py-1 text-sm font-semibold text-emerald-200">
              {recommendedSize ?? 'Awaiting a confident size'}
            </span>
          </div>

          <div className="mt-6">
            <DebugGalleryUpload tenantId={tenantId} />
          </div>
        </section>

        <aside className="obsidian-glass p-5">
          <h2 className="text-lg font-semibold text-obsidian-ink">Event inspector</h2>
          <p className="mt-1 text-sm text-obsidian-muted">Newest event first. Payloads are captured at the host boundary.</p>
          <ol className="mt-4 flex max-h-[720px] flex-col gap-3 overflow-y-auto pr-1">
            {events.length === 0 ? (
              <li className="rounded-lg border border-dashed border-white/15 p-4 text-sm text-obsidian-subtle">
                Waiting for widget traffic.
              </li>
            ) : (
              events.map((event) => (
                <li key={event.id} className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-xs text-obsidian-accent-muted">{event.direction}</span>
                    <time className="text-xs text-obsidian-subtle">{event.timestamp}</time>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-obsidian-ink">{event.type}</p>
                  <pre className="mt-2 overflow-x-auto rounded bg-obsidian-canvas p-2 text-xs text-obsidian-muted">
                    {JSON.stringify(event.payload, null, 2)}
                  </pre>
                </li>
              ))
            )}
          </ol>
        </aside>
      </div>
    </main>
  );
}
