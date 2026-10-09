import type { PoseLandmarkSample } from '@/lib/widget/pose-gates';

const WEBP_MAX_EDGE_PX = 1024;
const WEBP_QUALITY = 0.85;
const FACE_VISIBILITY_MIN = 0.5;
const MIN_VISIBLE_FACE_LANDMARKS = 3;
const MIN_KEEP_HEIGHT_RATIO = 0.35;

/** MediaPipe Pose face landmarks: nose, eyes, ears, mouth. */
export const FACE_LANDMARK_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export interface HeadlessKeepBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function isVisibleFace(landmark: PoseLandmarkSample | undefined): landmark is PoseLandmarkSample {
  return landmark !== undefined && (landmark.visibility ?? 0) >= FACE_VISIBILITY_MIN;
}

/**
 * Pixel box of the body that remains after removing the head. Face landmarks
 * must sit strictly above `box.y` (image origin is top-left). Returns null when
 * the crop cannot be proven to exclude the face — callers must fail closed.
 */
export function headlessKeepBox(
  landmarks: readonly PoseLandmarkSample[],
  imageWidth: number,
  imageHeight: number,
): HeadlessKeepBox | null {
  if (imageWidth <= 0 || imageHeight <= 0) {
    return null;
  }

  const face = FACE_LANDMARK_INDICES.map((index) => landmarks[index]).filter(isVisibleFace);
  if (face.length < MIN_VISIBLE_FACE_LANDMARKS) {
    return null;
  }

  const faceMinY = Math.min(...face.map((landmark) => landmark.y));
  const faceMaxY = Math.max(...face.map((landmark) => landmark.y));
  const faceHeight = Math.max(faceMaxY - faceMinY, 0.04);
  const chinPad = Math.max(0.04, faceHeight * 0.35);
  const cropYNorm = Math.min(1 - MIN_KEEP_HEIGHT_RATIO, faceMaxY + chinPad);
  const y = Math.max(1, Math.round(cropYNorm * imageHeight));
  const height = imageHeight - y;
  if (height / imageHeight < MIN_KEEP_HEIGHT_RATIO) {
    return null;
  }

  const box: HeadlessKeepBox = { x: 0, y, width: imageWidth, height };
  const faceInsideKeep = face.some((landmark) => landmark.y * imageHeight >= box.y);
  if (faceInsideKeep) {
    return null;
  }

  return box;
}

function drawToWebpCanvas(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  keepBox?: HeadlessKeepBox,
): HTMLCanvasElement {
  const sx = keepBox?.x ?? 0;
  const sy = keepBox?.y ?? 0;
  const sw = keepBox?.width ?? sourceWidth;
  const sh = keepBox?.height ?? sourceHeight;
  const scale = Math.min(WEBP_MAX_EDGE_PX / sw, WEBP_MAX_EDGE_PX / sh, 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to allocate a canvas for WebP encoding.');
  }

  context.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function canvasToWebp(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('WebP encoding failed.'));
          return;
        }

        resolve(blob);
      },
      'image/webp',
      WEBP_QUALITY,
    );
  });
}

export async function encodeVideoFrameToWebp(
  video: HTMLVideoElement,
  landmarks: readonly PoseLandmarkSample[],
): Promise<Blob> {
  if (video.videoWidth <= 0 || video.videoHeight <= 0) {
    throw new Error('Camera frame is not ready.');
  }

  const keepBox = headlessKeepBox(landmarks, video.videoWidth, video.videoHeight);
  if (!keepBox) {
    throw new Error('Head crop failed. Face landmarks were not detected.');
  }

  return canvasToWebp(drawToWebpCanvas(video, video.videoWidth, video.videoHeight, keepBox));
}

/**
 * The full camera frame of one capture, kept in this browser so the shopper's
 * own look (face, hair, skin, clothes) can be painted on their avatar. A
 * canvas, never a Blob, so it cannot be uploaded by accident; released with
 * `releaseOnDevicePhoto` when Try On closes. `keepBox` is the headless region
 * that was uploaded, in this canvas's pixels, so GPU photo coordinates
 * (normalized to the upload) map back here, head included. `landmarks` are
 * the MediaPipe pose landmarks of this frame, normalized.
 */
export interface OnDevicePhoto {
  frame: HTMLCanvasElement;
  keepBox: HeadlessKeepBox;
  landmarks: Array<{ x: number; y: number; visibility: number }>;
}

const ON_DEVICE_PHOTO_MAX_EDGE_PX = 2560;

export function captureOnDevicePhoto(
  source: CanvasImageSource,
  landmarks: readonly PoseLandmarkSample[],
  imageWidth: number,
  imageHeight: number,
): OnDevicePhoto | null {
  const sourceBox = headlessKeepBox(landmarks, imageWidth, imageHeight);
  if (!sourceBox) {
    return null;
  }
  const scale = Math.min(ON_DEVICE_PHOTO_MAX_EDGE_PX / Math.max(imageWidth, imageHeight), 1);
  const frame = document.createElement('canvas');
  frame.width = Math.max(1, Math.round(imageWidth * scale));
  frame.height = Math.max(1, Math.round(imageHeight * scale));
  // Painting reads these pixels back on the CPU; without this hint phones do a slow GPU readback.
  const context = frame.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return null;
  }
  context.drawImage(source, 0, 0, frame.width, frame.height);
  return {
    frame,
    keepBox: {
      x: sourceBox.x * scale,
      y: sourceBox.y * scale,
      width: sourceBox.width * scale,
      height: sourceBox.height * scale,
    },
    landmarks: landmarks.map((landmark) => ({
      x: landmark.x,
      y: landmark.y,
      visibility: landmark.visibility ?? 0,
    })),
  };
}

/** The front and side frames of one fitting. */
export interface OnDevicePhotos {
  front: OnDevicePhoto | null;
  side: OnDevicePhoto | null;
}

/** Wipe the pixels now rather than waiting for garbage collection. */
export function releaseOnDevicePhoto(photo: OnDevicePhoto | null | undefined): void {
  if (!photo) {
    return;
  }
  photo.frame.width = 0;
  photo.frame.height = 0;
}

export function releaseOnDevicePhotos(photos: OnDevicePhotos | null | undefined): void {
  releaseOnDevicePhoto(photos?.front);
  releaseOnDevicePhoto(photos?.side);
}

/**
 * GPU `photo_uv` (normalized to the uploaded headless WebP; v < 0 is above the
 * head crop) → normalized coordinates in the full on-device frame.
 */
export function headlessUvToFrameUv(
  u: number,
  v: number,
  keepBox: HeadlessKeepBox,
  frameWidth: number,
  frameHeight: number,
): [number, number] {
  return [
    (keepBox.x + u * keepBox.width) / frameWidth,
    (keepBox.y + v * keepBox.height) / frameHeight,
  ];
}

export async function encodeImageFileToWebp(
  file: File,
  landmarks?: readonly PoseLandmarkSample[],
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const keepBox = landmarks
      ? headlessKeepBox(landmarks, bitmap.width, bitmap.height)
      : null;
    if (landmarks && !keepBox) {
      throw new Error('Head crop failed. Face landmarks were not detected.');
    }

    return await canvasToWebp(
      drawToWebpCanvas(bitmap, bitmap.width, bitmap.height, keepBox ?? undefined),
    );
  } finally {
    bitmap.close();
  }
}
