import { createClient } from '@/lib/supabase/client';
import { fetchFitJobStatus } from '@/lib/widget/fit-client';
import type { FitJobStatusPayload } from '@/types/hmr';

const POLL_INTERVAL_MS = 2000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readBroadcastStatus(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const payload = isRecord(value.payload) ? value.payload : value;
  return typeof payload.status === 'string' ? payload.status : null;
}

/**
 * Subscribes to the private topic `fit_job:{id}` and polls status as a backup.
 */
export function watchFitJob(
  jobId: string,
  embedToken: string | null,
  onChange: (job: FitJobStatusPayload) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = createClient();
  const topic = `fit_job:${jobId}`;
  let cancelled = false;

  const refresh = async (): Promise<void> => {
    try {
      const job = await fetchFitJobStatus(embedToken, jobId);
      if (!cancelled) {
        onChange(job);
      }
    } catch (error) {
      if (!cancelled) {
        onError(error instanceof Error ? error : new Error('Fit job status failed.'));
      }
    }
  };

  const channel = supabase
    .channel(topic, { config: { private: true } })
    .on('broadcast', { event: 'INSERT' }, (message) => {
      if (readBroadcastStatus(message) !== null) {
        void refresh();
      }
    })
    .on('broadcast', { event: 'UPDATE' }, (message) => {
      if (readBroadcastStatus(message) !== null) {
        void refresh();
      }
    })
    .subscribe();

  const intervalId = window.setInterval(() => {
    void refresh();
  }, POLL_INTERVAL_MS);

  void refresh();

  return () => {
    cancelled = true;
    window.clearInterval(intervalId);
    void supabase.removeChannel(channel);
  };
}
