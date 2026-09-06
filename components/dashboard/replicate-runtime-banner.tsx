'use client';

import { useEffect, useRef, useState, useTransition, type FC } from 'react';

import {
  REPLICATE_A100_USD_PER_SEC,
  SESSION_GPU_SAFETY_TIMEOUT_MS,
} from '@/lib/ml/session-gpu';

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
  action?: string;
  hardware?: { sku?: string; pin_mode?: string; deployment?: string | null };
  deployment?: {
    hardware?: string | null;
    min_instances?: number | null;
    max_instances?: number | null;
  };
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export const ReplicateRuntimeBanner: FC<ReplicateRuntimeBannerProps> = ({ config }) => {
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [minInstances, setMinInstances] = useState<number | null>(null);
  const [hardwareSku, setHardwareSku] = useState<string>(config.hardware.sku);
  const [deadlineMs, setDeadlineMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isPending, startTransition] = useTransition();
  const warmedRef = useRef(false);
  const blocked = config.operatorMessage !== null;

  const applyPayload = (payload: SessionGpuPayload, action: 'warm' | 'sleep' | 'status'): void => {
    const nextMin = payload.deployment?.min_instances ?? null;
    const nextSku = payload.deployment?.hardware ?? payload.hardware?.sku ?? config.hardware.sku;
    setMinInstances(nextMin);
    setHardwareSku(nextSku);

    if (action === 'warm' || (action === 'status' && nextMin !== null && nextMin >= 1)) {
      warmedRef.current = true;
      setDeadlineMs(Date.now() + SESSION_GPU_SAFETY_TIMEOUT_MS);
    }

    if (action === 'sleep' || nextMin === 0) {
      warmedRef.current = action === 'sleep' ? false : warmedRef.current && nextMin !== 0;
      if (action === 'sleep' || nextMin === 0) {
        setDeadlineMs(null);
      }
    }
  };

  const requestSession = (action: 'warm' | 'sleep' | 'status'): void => {
    if (action !== 'status') {
      setMessage(null);
      setIsError(false);
    }

    startTransition(async () => {
      try {
        const response = await fetch('/api/v1/hmr/keepalive', {
          method: action === 'status' ? 'GET' : 'POST',
          credentials: 'same-origin',
          headers: action === 'status' ? undefined : { 'Content-Type': 'application/json' },
          body: action === 'status' ? undefined : JSON.stringify({ action }),
        });
        const payload = (await response.json()) as SessionGpuPayload;

        if (!response.ok || payload.ok === false) {
          setIsError(true);
          setMessage(payload.message ?? 'Session GPU request failed. There is no mock fallback.');
          return;
        }

        applyPayload(payload, action);
        if (action === 'status') {
          return;
        }

        const min = payload.deployment?.min_instances;
        const sku = payload.deployment?.hardware ?? payload.hardware?.sku ?? config.hardware.sku;
        setMessage(
          action === 'warm'
            ? `A100 is idle-warm (min_instances=${min ?? 1}, ${sku}). Sleep it when you finish — the 45-minute safety timer will also sleep it.`
            : `A100 is asleep (min_instances=${min ?? 0}). Idle billing has stopped.`,
        );
      } catch {
        setIsError(true);
        setMessage('Unable to reach the session GPU route.');
      }
    });
  };

  useEffect(() => {
    if (blocked) {
      return;
    }

    requestSession('status');
    // Status on mount only. Sleep is explicit, 45-minute, or pagehide — not React unmount
    // (Strict Mode would otherwise scale the A100 to zero on every sandbox open).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked]);

  useEffect(() => {
    const onPageHide = (): void => {
      if (!warmedRef.current) {
        return;
      }

      void fetch('/api/v1/hmr/keepalive', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sleep' }),
        keepalive: true,
      });
    };

    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, []);

  useEffect(() => {
    if (deadlineMs === null) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [deadlineMs]);

  useEffect(() => {
    if (deadlineMs === null || nowMs < deadlineMs || isPending) {
      return;
    }

    setDeadlineMs(null);
    requestSession('sleep');
    setMessage('45-minute safety timeout slept the A100 (min_instances=0).');
    // requestSession is recreated each render; the deadline gate is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadlineMs, nowMs, isPending]);

  const remainingMs = deadlineMs === null ? null : deadlineMs - nowMs;
  const warm = minInstances !== null && minInstances >= 1;
  const creditSeconds = Math.round(5 / REPLICATE_A100_USD_PER_SEC);

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
            : ''}. Warm sets Deployment <span className="font-mono text-xs">min_instances=1</span> on{' '}
          {hardwareSku} so the next Try On skips a cold start. Idle time is billed
          (${REPLICATE_A100_USD_PER_SEC.toFixed(6)}/s; ~{creditSeconds.toLocaleString()}s per $5).
          Do not leave the A100 warm overnight.
        </p>
      )}
      {!blocked && minInstances !== null ? (
        <p className="mt-2 font-mono text-xs text-obsidian-accent-muted">
          min_instances={minInstances} · hardware={hardwareSku}
          {remainingMs !== null && warm ? ` · safety ${formatRemaining(remainingMs)}` : ''}
        </p>
      ) : null}
      {message ? (
        <p className={`mt-2 text-sm ${isError ? 'text-red-300' : 'text-emerald-300'}`}>{message}</p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => requestSession('warm')}
          disabled={blocked || isPending}
          className="obsidian-cta disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending && !warm ? 'Warming A100…' : 'Warm A100 for this session'}
        </button>
        <button
          type="button"
          onClick={() => requestSession('sleep')}
          disabled={blocked || isPending}
          className="rounded-full border border-white/15 px-4 py-2 text-sm text-obsidian-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending && warm ? 'Sleeping A100…' : 'Sleep A100'}
        </button>
      </div>
    </section>
  );
};
