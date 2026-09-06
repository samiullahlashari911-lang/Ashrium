'use client';

import { useEffect, useState, type FC } from 'react';

import { REPLICATE_A100_USD_PER_SEC } from '@/lib/ml/session-gpu';

export interface ReplicateRuntimeBannerConfig {
  tokenConfigured: boolean;
  modelVersionConfigured: boolean;
  deploymentConfigured: boolean;
  modelVersion: string | null;
  hardware: {
    sku: string;
    pinMode: 'deployment' | 'model_dashboard';
    deployment: string | null;
  };
  operatorMessage: string | null;
}

interface ReplicateRuntimeBannerProps {
  config: ReplicateRuntimeBannerConfig;
}

interface SessionGpuPayload {
  ok?: boolean;
  message?: string;
  deployment?: {
    hardware?: string | null;
    min_instances?: number | null;
  };
}

export const ReplicateRuntimeBanner: FC<ReplicateRuntimeBannerProps> = ({ config }) => {
  const [minInstances, setMinInstances] = useState<number | null>(null);
  const [hardwareSku, setHardwareSku] = useState<string>(config.hardware.sku);
  const blocked = config.operatorMessage !== null;
  const creditSeconds = Math.round(5 / REPLICATE_A100_USD_PER_SEC);

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

        setMinInstances(payload.deployment?.min_instances ?? null);
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
      <h2 className="text-lg font-semibold text-obsidian-ink">Live Replicate GPU</h2>
      {blocked ? (
        <p className="mt-2 text-sm text-amber-200">{config.operatorMessage}</p>
      ) : (
        <p className="mt-2 text-sm text-obsidian-muted">
          Token, Cog version, and Deployment are set. Predictions use{' '}
          <span className="font-mono text-xs">{config.modelVersion}</span>
          {config.hardware.deployment
            ? ` through ${config.hardware.deployment}`
            : ''}. The A100 on {hardwareSku} warms only when a shopper submits both
          verified photos. Merchants cannot start or sleep the GPU. Idle billing is{' '}
          ${REPLICATE_A100_USD_PER_SEC.toFixed(6)}/s (~{creditSeconds.toLocaleString()}s per $5).
        </p>
      )}
      {!blocked && minInstances !== null ? (
        <p className="mt-2 font-mono text-xs text-obsidian-accent-muted">
          min_instances={minInstances} · hardware={hardwareSku}
        </p>
      ) : null}
    </section>
  );
};
