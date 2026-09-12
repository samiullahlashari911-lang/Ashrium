'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { EmptyState } from '@/components/dashboard/empty-state';
import {
  ReplicateRuntimeBanner,
  type ReplicateRuntimeBannerConfig,
} from '@/components/dashboard/replicate-runtime-banner';
import { VFR_WIDGET_SCRIPT_SRC } from '@/lib/widget/embed-origin';
import type { GarmentIngestMode, GarmentIngestTier } from '@/types/garment';

export interface SandboxGarmentOption {
  sku: string;
  name: string;
  mode: GarmentIngestMode | null;
  ingestTier: GarmentIngestTier | null;
  approximateFit: boolean;
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

function ingestLabel(garment: SandboxGarmentOption): string {
  const mode = garment.mode ?? '—';
  const tier = garment.ingestTier ? `Tier ${garment.ingestTier}` : 'no tier';
  const fit = garment.approximateFit ? 'Approximate' : 'Validated';
  return `${mode} · ${tier} · ${fit}`;
}

export function StorefrontSandbox({
  token,
  replicate,
  garments,
}: {
  tenantId: string;
  token: string;
  replicate: ReplicateRuntimeBannerConfig;
  garments: readonly SandboxGarmentOption[];
}): React.JSX.Element {
  const scriptMountRef = useRef<HTMLDivElement | null>(null);
  const nextLogIdRef = useRef(1);
  const initialSku = garments[0]?.sku ?? '';
  const [selectedSku, setSelectedSku] = useState(initialSku);
  const [recommendedSize, setRecommendedSize] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [events, setEvents] = useState<EventLogEntry[]>([]);

  const selectedGarment = garments.find((garment) => garment.sku === selectedSku)
    ?? garments[0]
    ?? null;

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
    if (!mount || !selectedSku) {
      return;
    }

    const script = document.createElement('script');
    script.src = VFR_WIDGET_SCRIPT_SRC;
    script.async = true;
    script.dataset.embedToken = token;
    script.dataset.sku = selectedSku;
    script.dataset.handle = selectedSku;
    script.dataset.allowGallery = 'true';
    script.dataset.launcher = 'true';
    mount.appendChild(script);

    const onWidgetMessage = (event: MessageEvent<unknown>): void => {
      if (event.origin !== window.location.origin || !isWidgetMessage(event.data)) {
        return;
      }

      addEvent('WIDGET_TO_HOST', event.data.type, event.data.payload);

      if (event.data.type === 'VFR_SIZE_RECOMMENDED' && typeof event.data.payload.size === 'string') {
        setRecommendedSize(event.data.payload.size);
      }
    };

    window.addEventListener('message', onWidgetMessage);

    return () => {
      window.removeEventListener('message', onWidgetMessage);
      document.getElementById('vfr-widget-root')?.remove();
      document.getElementById('ashrium-vfr-try-on')?.remove();
      document.getElementById('ashrium-vfr-overlay')?.remove();
      script.remove();
      delete sandboxWindow.AshriumVfrWidget;
      delete sandboxWindow.__ASHRIUM_VFR_WIDGET__;
    };
  }, [addEvent, selectedSku, token]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 p-6">
      <header>
        <p className="text-sm font-medium text-obsidian-accent-muted">Legendary store mock</p>
        <h1 className="mt-1 text-3xl font-bold text-obsidian-ink">Product page</h1>
        <p className="mt-2 text-sm text-obsidian-muted">
          Switch garments, then tap Try On above Add to cart. Phone camera only on the live
          storefront; gallery stays sandbox-only. A successful sandbox session is not storefront go-live.
        </p>
      </header>

      <ReplicateRuntimeBanner config={replicate} />

      {garments.length === 0 ? (
        <EmptyState
          title="Ingest garments before Try On"
          description="Sandbox lists CAD garments from this tenant. Sync the Legendary catalog on Garments first."
          action={{ href: '/dashboard/garments', label: 'Open Garments' }}
        />
      ) : (
        <section className="obsidian-glass overflow-hidden p-0">
          <div className="border-b border-white/10 bg-obsidian-canvas/40 px-6 py-4">
            <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-obsidian-subtle">
              Garment
              <select
                className="mt-2 block w-full rounded-xl border border-white/10 bg-obsidian-canvas px-3 py-2 text-sm text-obsidian-ink"
                value={selectedSku}
                onChange={(event) => {
                  setRecommendedSize(null);
                  setSelectedSku(event.target.value);
                }}
              >
                {garments.map((garment) => (
                  <option key={garment.sku} value={garment.sku}>
                    {garment.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-8 px-6 py-8 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="flex min-h-[320px] items-center justify-center rounded-2xl bg-gradient-to-br from-[#1B1538] to-[#0B0B1E] text-sm text-obsidian-subtle">
              Product photo
            </div>
            <div>
              <p className="font-mono text-xs text-obsidian-accent-muted">{selectedGarment?.sku}</p>
              <h2 className="mt-1 text-2xl font-semibold text-obsidian-ink">
                {selectedGarment?.name}
              </h2>
              {selectedGarment ? (
                <p className="mt-1 text-xs text-obsidian-muted">{ingestLabel(selectedGarment)}</p>
              ) : null}
              <p className="mt-4 text-sm text-obsidian-muted">
                Size charts come from the product page. Try On opens a camera overlay — not a gallery.
              </p>
              <div ref={scriptMountRef} className="mt-5" />
              <button
                type="button"
                className="mt-2 w-full rounded-full border border-white/15 px-4 py-3 text-sm font-semibold text-obsidian-ink"
              >
                Add to cart
              </button>
              <div className="mt-4 flex items-center gap-3">
                <span className="text-sm text-obsidian-muted">Recommended size</span>
                <span className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-3 py-1 text-sm font-semibold text-emerald-200">
                  {recommendedSize ?? 'Complete Try On first'}
                </span>
              </div>
            </div>
          </div>
        </section>
      )}

      <details
        className="obsidian-glass p-4 text-sm text-obsidian-muted"
        open={showLog}
        onToggle={(event) => setShowLog(event.currentTarget.open)}
      >
        <summary className="cursor-pointer font-semibold text-obsidian-ink">Developer log</summary>
        <ol className="mt-4 flex max-h-[360px] flex-col gap-3 overflow-y-auto pr-1">
          {events.length === 0 ? (
            <li className="rounded-lg border border-dashed border-white/15 p-4 text-sm text-obsidian-subtle">
              Widget events appear here after Try On.
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
      </details>
    </main>
  );
}
