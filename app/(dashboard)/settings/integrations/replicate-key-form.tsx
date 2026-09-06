'use client';

import { useRef, useState, useTransition, type FC, type FormEvent } from 'react';

import { saveMerchantReplicateKey } from '@/lib/server/tenant-keys';

export interface ReplicateKeyFormProps {
  hasActiveKey: boolean;
}

export const ReplicateKeyForm: FC<ReplicateKeyFormProps> = ({ hasActiveKey }) => {
  const keyInputRef = useRef<HTMLInputElement | null>(null);
  const [message, setMessage] = useState<string>(
    hasActiveKey ? 'An active key is stored as r8_...****.' : '',
  );
  const [isError, setIsError] = useState<boolean>(false);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    const apiKey = keyInputRef.current?.value ?? '';
    setMessage('');
    setIsError(false);

    startTransition(async () => {
      const result = await saveMerchantReplicateKey(apiKey);
      setMessage(result.success ? `${result.message} ${result.maskedKey}` : result.message);
      setIsError(!result.success);

      if (result.success && keyInputRef.current) {
        keyInputRef.current.value = '';
      }
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="obsidian-glass p-6"
    >
      <div className="border-b border-white/10 pb-4">
        <h2 className="text-lg font-semibold text-obsidian-ink">Replicate BYOK</h2>
        <p className="mt-1 text-sm text-obsidian-muted">
          Your key is verified with Replicate, encrypted server-side, and never displayed again.
        </p>
      </div>

      <label className="mt-5 flex flex-col gap-2 text-sm font-medium text-obsidian-ink">
        Replicate API key
        <input
          ref={keyInputRef}
          required
          type="password"
          name="replicateApiKey"
          autoComplete="off"
          spellCheck={false}
          placeholder="r8_..."
          className="obsidian-input-box font-mono text-sm"
        />
      </label>

      {message ? (
        <p className={`mt-4 text-sm ${isError ? 'text-red-300' : 'text-emerald-300'}`}>{message}</p>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="obsidian-cta mt-5"
      >
        {isPending ? 'Validating…' : hasActiveKey ? 'Replace key' : 'Save key'}
      </button>
    </form>
  );
};
