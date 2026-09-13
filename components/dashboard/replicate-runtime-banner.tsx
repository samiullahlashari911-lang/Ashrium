'use client';

import { useEffect, useState, type FC } from 'react';

import { MODAL_A100_USD_PER_SEC } from '@/lib/ml/session-gpu';
import type { ModalRuntimeConfig } from '@/lib/ml/gpu';

export type GpuRuntimeBannerConfig = ModalRuntimeConfig;

interface GpuRuntimeBannerProps {
  config: GpuRuntimeBannerConfig;
}

interface SessionGpuPayload {
  ok?: boolean;
  message?: string;
  deployment?: {
    hardware?: string | null;
    min_containers?: number | null;
    min_instances?: number | null;
  };
}

export const GpuRuntimeBanner: FC<GpuRuntimeBannerProps> = ({ config }) => {
  const [minContainers, setMinContainers] = useState<number | null>(null);
  const [hardwareSku, setHardwareSku] = useState<string>(config.hardware.sku);
  const blocked = config.operatorMessage !== null;
  const creditSeconds = Math.round(5 / MODAL_A100_USD_PER_SEC);

  useEffect(() => {
    if (blocked) {
      return;
    }

    let cancelled = false;
    void fetch('/api/v1/hmr/keepalive', {
      method: 'GET',
      credentials: 'same-origin',
    })
      .then(async (response) => {
        const payload = (await response.json()) as SessionGpuPayload;
        if (cancelled || !response.ok || payload.ok === false) {
          return;
        }

        setMinContainers(
          payload.deployment?.min_containers ?? payload.deployment?.min_instances ?? null,
        );
        if (payload.deployment?.hardware) {
          setHardwareSku(payload.deployment.hardware);
        }
      })
      .catch(() => {
        // Status is informational. Shopper submit still warms the GPU server-side.
      });

    return () => {
      cancelled = true;
    };
  }, [blocked]);

  return (
    <section
      className={[
        'obsidian-glass p-5',
        blocked ? 'border border-amber-500/40' : '',
      ].join(' ')}
    >
      <h2 className="text-lg font-semibold text-obsidian-ink">Live Modal GPU</h2>
      {blocked ? (
        <p className="mt-2 text-sm text-amber-200">{config.operatorMessage}</p>
      ) : (
        <p className="mt-2 text-sm text-obsidian-muted">
          Modal A100-80GB is configured at{' '}
          <span className="font-mono text-xs">{config.gpuUrl}</span>
          {config.hardware.deployment ? ` (${config.hardware.deployment})` : ''}.
          The GPU warms when a shopper passes age and privacy consent. Merchants cannot
          start or sleep it. Idle billing is ${MODAL_A100_USD_PER_SEC.toFixed(6)}/s
          (~{creditSeconds.toLocaleString()}s per $5).
        </p>
      )}
      {!blocked && minContainers !== null ? (
        <p className="mt-2 font-mono text-xs text-obsidian-accent-muted">
          min_containers={minContainers} · hardware={hardwareSku}
        </p>
      ) : null}
    </section>
  );
};

/** @deprecated Use GpuRuntimeBanner. */
export const ReplicateRuntimeBanner = GpuRuntimeBanner;
export type ReplicateRuntimeBannerConfig = GpuRuntimeBannerConfig;
