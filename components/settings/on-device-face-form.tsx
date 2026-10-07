'use client';

import { useState, useTransition } from 'react';

import { updateOnDeviceFace } from '@/lib/server/tenant-settings';

/**
 * Off by default. Turning it on shows each shopper their own face on their
 * avatar, drawn on their device only — Ashrium servers still receive only
 * headless photos. Counsel should review before enabling on a live store.
 */
export function OnDeviceFaceForm({ initialEnabled }: { initialEnabled: boolean }): React.JSX.Element {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const toggle = (): void => {
    const next = !enabled;
    startTransition(async () => {
      const result = await updateOnDeviceFace(next);
      setEnabled(result.enabled);
      setMessage(result.message);
    });
  };

  return (
    <section className="ash-card flex flex-col gap-4 p-6" aria-labelledby="face-setting-title">
      <div className="flex items-start justify-between gap-6">
        <div className="flex flex-col gap-1">
          <h2 id="face-setting-title" className="font-semibold text-ash-ink">Show the shopper’s face on their avatar</h2>
          <p className="max-w-xl text-sm text-ash-muted">
            The face is cut from their front photo and drawn on their avatar on their own phone. It is never uploaded,
            stored, or seen by you or Ashrium, and it disappears when they close Try On.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-labelledby="face-setting-title"
          disabled={isPending}
          onClick={toggle}
          className={[
            'relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50',
            enabled ? 'bg-ash-accent' : 'bg-ash-line',
          ].join(' ')}
        >
          <span
            aria-hidden="true"
            className={[
              'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200',
              enabled ? 'translate-x-6' : 'translate-x-1',
            ].join(' ')}
          />
        </button>
      </div>
      <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
        Faces are sensitive data in some places (for example Illinois BIPA and the GDPR). Have your counsel review this
        before turning it on for a live store. This is not legal advice.
      </p>
      {message ? <p role="status" className="text-sm text-ash-muted">{message}</p> : null}
    </section>
  );
}
