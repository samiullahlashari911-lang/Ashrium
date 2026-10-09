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

const ON_DEVICE_PHOTO_MAX_EDGE_PX = 1920;

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
  const context = frame.getContext('2d');
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

/** Wipe the pixels now rather than waiting for garbage collection. */
export function releaseOnDevicePhoto(photo: OnDevicePhoto | null | undefined): void {
  if (!photo) {
    return;
  }
  photo.frame.width = 0;
  photo.frame.height = 0;
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

/**
 * On-device face for the shopper's own avatar (merchant opt-in, default off).
 * Returned as a canvas, never a Blob, so it cannot be uploaded by accident:
 * it is only ever drawn as a texture in this browser and is dropped when Try
 * On closes. The crop spans chin to crown and ear to ear, with a soft oval
 * alpha so the edges melt into the mannequin head.
 */
export type OnDeviceFace = HTMLCanvasElement;

const FACE_TEXTURE_WIDTH_PX = 256;

export function cropOnDeviceFace(
  source: CanvasImageSource,
  landmarks: readonly PoseLandmarkSample[],
  imageWidth: number,
  imageHeight: number,
): OnDeviceFace | null {
  const point = (index: number): { x: number; y: number } | null => {
    const landmark = landmarks[index];
    return isVisibleFace(landmark) ? { x: landmark.x * imageWidth, y: landmark.y * imageHeight } : null;
  };
  const nose = point(0);
  const leftEye = point(2);
  const rightEye = point(5);
  const mouthLeft = point(9);
  const mouthRight = point(10);
  if (!nose || !leftEye || !rightEye || !mouthLeft || !mouthRight) {
    return null;
  }

  const eyeY = (leftEye.y + rightEye.y) / 2;
  const mouthY = (mouthLeft.y + mouthRight.y) / 2;
  const faceHeight = mouthY - eyeY;
  if (faceHeight <= 2) {
    return null;
  }
  const leftEar = point(7);
  const rightEar = point(8);
  const earHalf = leftEar && rightEar ? Math.abs(leftEar.x - rightEar.x) / 2 : 0;
  const halfWidth = Math.max(earHalf * 1.2, faceHeight * 1.45);
  const top = Math.max(0, eyeY - faceHeight * 1.8);
  const bottom = Math.min(imageHeight, mouthY + faceHeight * 1.1);
  const left = Math.max(0, nose.x - halfWidth);
  const right = Math.min(imageWidth, nose.x + halfWidth);
  const width = right - left;
  const height = bottom - top;
  if (width <= 4 || height <= 4) {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = FACE_TEXTURE_WIDTH_PX;
  canvas.height = Math.round((FACE_TEXTURE_WIDTH_PX * height) / width);
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }
  context.drawImage(source, left, top, width, height, 0, 0, canvas.width, canvas.height);

  // Soft oval mask: opaque face, feathered edges.
  context.globalCompositeOperation = 'destination-in';
  const radius = Math.max(canvas.width, canvas.height) / 2;
  const gradient = context.createRadialGradient(0, 0, radius * 0.72, 0, 0, radius);
  gradient.addColorStop(0, 'rgba(0,0,0,1)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  context.save();
  context.translate(canvas.width / 2, canvas.height / 2);
  context.scale(canvas.width / (2 * radius), canvas.height / (2 * radius));
  context.fillStyle = gradient;
  context.fillRect(-radius, -radius, radius * 2, radius * 2);
  context.restore();
  context.globalCompositeOperation = 'source-over';
  return canvas;
}
