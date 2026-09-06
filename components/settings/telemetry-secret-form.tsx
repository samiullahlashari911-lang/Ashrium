'use client';

import { useState, useTransition } from 'react';

import { EmptyState } from '@/components/dashboard/empty-state';

export interface TelemetrySecretFormProps {
  configured: boolean;
  webhookUrl: string;
}

interface CredentialsResponse {
  code?: string;
  tenant_id?: string;
  webhook_secret?: string;
}

export function TelemetrySecretForm({
  configured,
  webhookUrl,
}: TelemetrySecretFormProps): React.JSX.Element {
  const [secret, setSecret] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleRotate = (): void => {
    setMessage('');
    setIsError(false);
    setSecret(null);

    startTransition(async () => {
      try {
        const response = await fetch('/api/v1/telemetry/credentials', {
          method: 'POST',
          credentials: 'same-origin',
        });
        const payload = (await response.json()) as CredentialsResponse;

        if (!response.ok || typeof payload.webhook_secret !== 'string') {
          setIsError(true);
          setMessage(payload.code ?? 'Unable to rotate the telemetry webhook secret.');
          return;
        }

        setSecret(payload.webhook_secret);
        setMessage('New webhook secret issued. Copy it now — it will not be shown again.');
      } catch {
        setIsError(true);
        setMessage('Unable to reach telemetry credentials.');
      }
    });
  };

  return (
    <section className="obsidian-glass p-6">
      <header className="border-b border-white/10 pb-4">
        <h2 className="text-lg font-semibold text-obsidian-ink">Telemetry webhook</h2>
        <p className="mt-1 text-sm text-obsidian-muted">
          Post order and return events to this URL with the tenant id and HMAC secret. Rotating
          the secret immediately invalidates the previous one.
        </p>
      </header>

      {webhookUrl ? (
        <p className="mt-5 font-mono text-xs text-obsidian-accent-muted break-all">{webhookUrl}</p>
      ) : (
        <p className="mt-5 text-sm text-obsidian-muted">
          Set <span className="font-mono text-xs">APP_BASE_URL</span> to display the public webhook
          endpoint.
        </p>
      )}

      {!configured && !secret ? (
        <div className="mt-5">
          <EmptyState
            title="No telemetry secret yet"
            description="Issue a webhook secret so the return-rate dashboard can ingest live order events. The secret is shown once."
          />
        </div>
      ) : null}

      {secret ? (
        <p className="mt-5 break-all rounded-2xl border border-white/10 bg-obsidian-canvas/60 px-4 py-3 font-mono text-sm text-obsidian-ink">
          {secret}
        </p>
      ) : null}

      {message ? (
        <p className={`mt-4 text-sm ${isError ? 'text-rose-300' : 'text-emerald-300'}`}>{message}</p>
      ) : null}

      <button type="button" disabled={isPending} onClick={handleRotate} className="obsidian-cta mt-5">
        {isPending ? 'Issuing…' : configured ? 'Rotate webhook secret' : 'Create webhook secret'}
      </button>
    </section>
  );
}
