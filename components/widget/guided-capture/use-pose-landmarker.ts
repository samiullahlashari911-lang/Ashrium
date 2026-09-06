'use client';

import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { PoseLandmarker } from '@mediapipe/tasks-vision';

import type { PoseLandmarkSample } from '@/lib/widget/pose-gates';

const MEDIAPIPE_VERSION = '1.0.1';
const WASM_BASE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export function usePoseLandmarker(): {
  landmarkerRef: MutableRefObject<PoseLandmarker | null>;
  ready: boolean;
  error: string | null;
} {
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const start = async (): Promise<void> => {
      const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_URL);

      const create = async (delegate: 'GPU' | 'CPU'): Promise<PoseLandmarker> =>
        PoseLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: POSE_MODEL_URL,
            delegate,
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

      let landmarker: PoseLandmarker;
      try {
        landmarker = await create('GPU');
      } catch {
        landmarker = await create('CPU');
      }

      if (cancelled) {
        landmarker.close();
        return;
      }

      landmarkerRef.current = landmarker;
      setReady(true);
    };

    start().catch((caught: unknown) => {
      if (!cancelled) {
        setError(caught instanceof Error ? caught.message : 'Pose guidance failed to load.');
      }
    });

    return () => {
      cancelled = true;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, []);

  return { landmarkerRef, ready, error };
}

export async function detectStillLandmarks(
  landmarker: PoseLandmarker,
  image: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
): Promise<PoseLandmarkSample[] | undefined> {
  await landmarker.setOptions({ runningMode: 'IMAGE' });
  try {
    const result = landmarker.detect(image);
    return result.landmarks[0] as PoseLandmarkSample[] | undefined;
  } finally {
    await landmarker.setOptions({ runningMode: 'VIDEO' });
  }
}
