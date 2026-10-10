'use client';

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { PoseLandmarker } from '@mediapipe/tasks-vision';

import type { PoseLandmarkSample } from '@/lib/widget/pose-gates';

const MEDIAPIPE_VERSION = '1.0.1';
const WASM_BASE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const MODEL_BASE_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker';
/** Steadier points for the gate and the avatar fit; `lite` only when the phone is too slow for it. */
const POSE_MODEL_URLS = {
  full: `${MODEL_BASE_URL}/pose_landmarker_full/float16/1/pose_landmarker_full.task`,
  lite: `${MODEL_BASE_URL}/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
} as const;

export type PoseModel = keyof typeof POSE_MODEL_URLS;

export interface PoseLandmarkerHandle {
  landmarkerRef: MutableRefObject<PoseLandmarker | null>;
  ready: boolean;
  error: string | null;
  model: PoseModel;
  /** Swap to the lite model (slow phone); a no-op once on lite. */
  fallBackToLite: () => void;
}

/**
 * One pose model for the whole capture: it loads while the shopper answers
 * the intake questions and is shared by the front and side screens, so
 * neither waits for a fresh load.
 */
export function usePoseLandmarker(): PoseLandmarkerHandle {
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const createRef = useRef<((model: PoseModel) => Promise<PoseLandmarker>) | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<PoseModel>('full');
  const modelRef = useRef<PoseModel>('full');
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    const start = async (): Promise<void> => {
      const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_URL);

      const createWith = (variant: PoseModel, delegate: 'GPU' | 'CPU'): Promise<PoseLandmarker> =>
        PoseLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: POSE_MODEL_URLS[variant],
            delegate,
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      const create = async (variant: PoseModel): Promise<PoseLandmarker> => {
        try {
          return await createWith(variant, 'GPU');
        } catch {
          return createWith(variant, 'CPU');
        }
      };
      createRef.current = create;

      let landmarker: PoseLandmarker;
      try {
        landmarker = await create('full');
      } catch {
        modelRef.current = 'lite';
        setModel('lite');
        landmarker = await create('lite');
      }

      if (cancelledRef.current) {
        landmarker.close();
        return;
      }

      landmarkerRef.current = landmarker;
      setReady(true);
    };

    start().catch((caught: unknown) => {
      if (!cancelledRef.current) {
        setError(caught instanceof Error ? caught.message : 'Pose guidance failed to load.');
      }
    });

    return () => {
      cancelledRef.current = true;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, []);

  const fallBackToLite = useCallback(() => {
    const create = createRef.current;
    if (modelRef.current === 'lite' || !create) {
      return;
    }
    modelRef.current = 'lite';
    setModel('lite');
    void create('lite')
      .then((lite) => {
        if (cancelledRef.current) {
          lite.close();
          return;
        }
        const previous = landmarkerRef.current;
        landmarkerRef.current = lite;
        previous?.close();
      })
      .catch(() => {
        // Keep the full model; it works, just slowly.
      });
  }, []);

  return { landmarkerRef, ready, error, model, fallBackToLite };
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
