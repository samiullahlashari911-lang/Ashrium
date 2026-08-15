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
      className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 shadow-lg backdrop-blur"
    >
      <div className="border-b border-slate-800 pb-4">
        <h2 className="text-lg font-semibold text-slate-100">Replicate BYOK</h2>
        <p className="mt-1 text-sm text-slate-400">
          Your key is verified with Replicate, encrypted server-side, and never displayed again.
        </p>
      </div>

      <label className="mt-5 flex flex-col gap-2 text-sm font-medium text-slate-200">
        Replicate API key
        <input
          ref={keyInputRef}
          required
          type="password"
          name="replicateApiKey"
          autoComplete="off"
          spellCheck={false}
          placeholder="r8_..."
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 outline-none transition focus:border-sky-400"
        />
      </label>

      {message ? (
        <p className={`mt-4 text-sm ${isError ? 'text-red-300' : 'text-emerald-300'}`}>{message}</p>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="mt-5 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? 'Validating…' : hasActiveKey ? 'Replace key' : 'Save key'}
      </button>
    </form>
  );
};
