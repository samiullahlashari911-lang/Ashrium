import * as THREE from 'three';

import {
  headlessUvToFrameUv,
  type HeadlessKeepBox,
  type OnDevicePhoto,
} from '@/lib/widget/webp-encode';
import type { MhrPhotoUv } from '@/types/hmr';

/**
 * The shopper's own look on their avatar, painted in this browser only.
 *
 * The GPU returns, per LOD 1 vertex, where it lands in each headless upload
 * and how well each view sees it (`MhrPhotoUv`). Here those coordinates are
 * mapped into the full on-device frames (head included), the head is snapped
 * onto the MediaPipe face landmarks of the same frame (the GPU never saw the
 * head, so its head pose is a guess), and a material samples both frames per
 * fragment. Nothing here is uploaded or stored.
 */

/** MediaPipe Pose indices. "Left" is the shopper's left (image right when facing the camera). */
export const POSE_NOSE = 0;
export const POSE_LEFT_EYE = 2;
export const POSE_RIGHT_EYE = 5;
export const POSE_LEFT_EAR = 7;
export const POSE_RIGHT_EAR = 8;
export const POSE_MOUTH_LEFT = 9;
export const POSE_MOUTH_RIGHT = 10;

const LANDMARK_VISIBLE = 0.5;
/** Full head correction from just under the mouth up; none below the neck. */
const HEAD_BLEND_FULL_BELOW_NOSE_M = 0.05;
const HEAD_BLEND_ZERO_BELOW_NOSE_M = 0.11;
/** Vertices no photo can reach (disconnected bits) fall back to the front projection. */
const UNSEEN_WEIGHT = 0.004;
/** A head painted taller than this (to reach the hair top) means the hair detection misfired. */
const MAX_HAIR_STRETCH = 1.8;

/** MHR LOD 1 head anchors (vertex indices) matched to MediaPipe face landmarks. */
export interface HeadAnchors {
  nose: number;
  leftEye: number;
  rightEye: number;
  mouthLeft: number;
  mouthRight: number;
  leftEar: number;
  rightEar: number;
  /** Nose tip height (canonical, metres) for the neck blend. */
  noseY: number;
}

const ANCHOR_LANDMARKS: Array<[keyof Omit<HeadAnchors, 'noseY'>, number]> = [
  ['nose', POSE_NOSE],
  ['leftEye', POSE_LEFT_EYE],
  ['rightEye', POSE_RIGHT_EYE],
  ['mouthLeft', POSE_MOUTH_LEFT],
  ['mouthRight', POSE_MOUTH_RIGHT],
  ['leftEar', POSE_LEFT_EAR],
  ['rightEar', POSE_RIGHT_EAR],
];

/**
 * Face anchors from the canonical mesh itself (metres, y up, +z forward,
 * +x the shopper's left). The MHR face is smooth, so eyes and mouth corners
 * are the front-most vertices at their usual offsets from the nose tip; the
 * least-squares fit below absorbs the centimetre-level slack.
 */
export function findHeadAnchors(positions: Float32Array): HeadAnchors | null {
  const count = positions.length / 3;
  let top = -Infinity;
  let bottom = Infinity;
  for (let i = 0; i < count; i += 1) {
    top = Math.max(top, positions[i * 3 + 1]!);
    bottom = Math.min(bottom, positions[i * 3 + 1]!);
  }
  const stature = top - bottom;
  if (!(stature > 0.5)) {
    return null;
  }
  const headFloor = top - stature * 0.16;

  let nose = -1;
  for (let i = 0; i < count; i += 1) {
    const y = positions[i * 3 + 1]!;
    if (y < headFloor || Math.abs(positions[i * 3]!) > 0.015) {
      continue;
    }
    if (nose < 0 || positions[i * 3 + 2]! > positions[nose * 3 + 2]!) {
      nose = i;
    }
  }
  if (nose < 0) {
    return null;
  }
  const nx = positions[nose * 3]!;
  const ny = positions[nose * 3 + 1]!;

  const frontMost = (dx: number, dy: number): number => {
    let best = -1;
    for (let i = 0; i < count; i += 1) {
      if (Math.abs(positions[i * 3]! - (nx + dx)) > 0.008 || Math.abs(positions[i * 3 + 1]! - (ny + dy)) > 0.008) {
        continue;
      }
      if (best < 0 || positions[i * 3 + 2]! > positions[best * 3 + 2]!) {
        best = i;
      }
    }
    return best;
  };
  const lateralMost = (side: 1 | -1): number => {
    let best = -1;
    for (let i = 0; i < count; i += 1) {
      const y = positions[i * 3 + 1]!;
      if (y < headFloor || Math.abs(y - ny) > 0.015) {
        continue;
      }
      if (best < 0 || side * positions[i * 3]! > side * positions[best * 3]!) {
        best = i;
      }
    }
    return best;
  };

  const anchors: HeadAnchors = {
    nose,
    leftEye: frontMost(0.032, 0.03),
    rightEye: frontMost(-0.032, 0.03),
    mouthLeft: frontMost(0.024, -0.027),
    mouthRight: frontMost(-0.024, -0.027),
    leftEar: lateralMost(1),
    rightEar: lateralMost(-1),
    noseY: ny,
  };
  return Object.values(anchors).every((value) => value >= 0) ? anchors : null;
}

/** 2D similarity (rotation + uniform scale + translation): p' = [a -b; b a] p + t. */
export interface Similarity2D {
  a: number;
  b: number;
  tx: number;
  ty: number;
}

export function fitSimilarity2D(
  source: ReadonlyArray<readonly [number, number]>,
  target: ReadonlyArray<readonly [number, number]>,
): Similarity2D | null {
  const n = source.length;
  if (n < 2 || target.length !== n) {
    return null;
  }
  let sx = 0;
  let sy = 0;
  let tx = 0;
  let ty = 0;
  for (let i = 0; i < n; i += 1) {
    sx += source[i]![0];
    sy += source[i]![1];
    tx += target[i]![0];
    ty += target[i]![1];
  }
  sx /= n;
  sy /= n;
  tx /= n;
  ty /= n;
  let dot = 0;
  let cross = 0;
  let norm = 0;
  for (let i = 0; i < n; i += 1) {
    const px = source[i]![0] - sx;
    const py = source[i]![1] - sy;
    const qx = target[i]![0] - tx;
    const qy = target[i]![1] - ty;
    dot += px * qx + py * qy;
    cross += px * qy - py * qx;
    norm += px * px + py * py;
  }
  if (norm < 1e-12) {
    return null;
  }
  const a = dot / norm;
  const b = cross / norm;
  return { a, b, tx: tx - (a * sx - b * sy), ty: ty - (b * sx + a * sy) };
}

export function applySimilarity(t: Similarity2D, x: number, y: number): [number, number] {
  return [t.a * x - t.b * y + t.tx, t.b * x + t.a * y + t.ty];
}

/** Where the photo is not seen at all: 0 below the neck, 1 on the face. */
function headBlend(y: number, noseY: number): number {
  const full = noseY - HEAD_BLEND_FULL_BELOW_NOSE_M;
  const zero = noseY - HEAD_BLEND_ZERO_BELOW_NOSE_M;
  const t = Math.min(1, Math.max(0, (y - zero) / (full - zero)));
  return t * t * (3 - 2 * t);
}

export interface PhotoFrameMeta {
  keepBox: HeadlessKeepBox;
  width: number;
  height: number;
  landmarks: OnDevicePhoto['landmarks'];
  /** Top of the hair in this frame (normalized y), found against the background. */
  hairTopY?: number | null;
  /** The frame's RGBA pixels, read once on the device and wiped after painting. */
  pixels?: FramePixels | null;
  /**
   * Wall colour behind the head. The server never sees the head, so it cannot
   * mask it: head vertices whose pixel is the wall count as unseen instead.
   */
  wall?: [number, number, number] | null;
}

export interface FramePixels {
  rgba: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** Colour distance (sRGB 0-255) under which a pixel counts as the background. */
const BACKGROUND_DISTANCE = 45;
/**
 * The wall only leaks in at the head's outline, where the surface turns away
 * from the camera (GPU weight = facing x 255). Face-on skin can be as pale as
 * a beige wall, so it is never tested: that blotched the cheeks.
 */
const WALL_TEST_MAX_WEIGHT = 140;
/**
 * Photo detail is trusted from this blend confidence up; below it the surface
 * fades to the diffused fill. Feathering over a few rings of vertices hides
 * the edge between photo and fill (hard 0/1 edges read as seams).
 */
const CONFIDENT = 0.6;
const CONFIDENCE_FEATHER_PASSES = 3;
/** Smoothing passes of the unseen-area fill colour (mesh Laplacian, seeds fixed). */
const FILL_DIFFUSION_PASSES = 120;
/** Side photo colour gain is fitted on vertices both photos see at least this well. */
const BOTH_SEEN = 0.35;

export interface HeadAlignment {
  /** Landmarks used for the fit. */
  used: number;
  /** RMS anchor error after the fit, as a fraction of the eye-to-mouth height. */
  residual: number;
}

/**
 * Frame-normalized (u, v) per vertex for one view, with the head snapped onto
 * that frame's face landmarks. Returns the alignment report, or null when too
 * few landmarks were visible to correct the head (then the GPU guess stays).
 */
export function frameUvForView(
  photoUv: readonly number[],
  frame: PhotoFrameMeta,
  positions: Float32Array,
  anchors: HeadAnchors | null,
  out: Float32Array,
  seen?: readonly number[],
): HeadAlignment | null {
  const count = positions.length / 3;
  for (let i = 0; i < count; i += 1) {
    const [u, v] = headlessUvToFrameUv(
      photoUv[i * 2]!,
      photoUv[i * 2 + 1]!,
      frame.keepBox,
      frame.width,
      frame.height,
    );
    out[i * 2] = u;
    out[i * 2 + 1] = v;
  }
  if (!anchors) {
    return null;
  }

  // Fit in pixels so the correction keeps the face's aspect ratio. MediaPipe
  // reports the far eye and ear of a profile as "visible" too, so a point is
  // used only when this view also sees its vertex (GPU weight > 0).
  const source: Array<[number, number]> = [];
  const target: Array<[number, number]> = [];
  for (const [key, landmarkIndex] of ANCHOR_LANDMARKS) {
    const landmark = frame.landmarks[landmarkIndex];
    if (!landmark || landmark.visibility < LANDMARK_VISIBLE) {
      continue;
    }
    const vertex = anchors[key];
    if (seen && !(seen[vertex]! > 0)) {
      continue;
    }
    source.push([out[vertex * 2]! * frame.width, out[vertex * 2 + 1]! * frame.height]);
    target.push([landmark.x * frame.width, landmark.y * frame.height]);
  }
  const transform = fitSimilarity2D(source, target);
  if (!transform) {
    return null;
  }

  let squared = 0;
  for (let i = 0; i < source.length; i += 1) {
    const [x, y] = applySimilarity(transform, source[i]![0], source[i]![1]);
    squared += (x - target[i]![0]) ** 2 + (y - target[i]![1]) ** 2;
  }
  const eyes = frame.landmarks[POSE_LEFT_EYE];
  const mouth = frame.landmarks[POSE_MOUTH_LEFT];
  const faceHeightPx = eyes && mouth && eyes.visibility >= LANDMARK_VISIBLE && mouth.visibility >= LANDMARK_VISIBLE
    ? Math.abs(mouth.y - eyes.y) * frame.height
    : 1;

  for (let i = 0; i < count; i += 1) {
    const weight = headBlend(positions[i * 3 + 1]!, anchors.noseY);
    if (weight <= 0) {
      continue;
    }
    const px = out[i * 2]! * frame.width;
    const py = out[i * 2 + 1]! * frame.height;
    const [x, y] = applySimilarity(transform, px, py);
    out[i * 2] = (px + (x - px) * weight) / frame.width;
    out[i * 2 + 1] = (py + (y - py) * weight) / frame.height;
  }
  if (frame.hairTopY !== null && frame.hairTopY !== undefined) {
    stretchHeadToHairTop(out, positions, anchors, frame.hairTopY);
  }
  return {
    used: source.length,
    residual: Math.sqrt(squared / source.length) / Math.max(faceHeightPx, 1),
  };
}

/**
 * MHR's head is a bare scalp; real hair stands above it. Above the eyes,
 * stretch the head's photo coordinates so its crown reaches the hair top,
 * growing towards the crown so the brows stay where they are.
 */
function stretchHeadToHairTop(
  out: Float32Array,
  positions: Float32Array,
  anchors: HeadAnchors,
  hairTopY: number,
): void {
  const count = positions.length / 3;
  let crown = 0;
  for (let i = 1; i < count; i += 1) {
    if (positions[i * 3 + 1]! > positions[crown * 3 + 1]!) {
      crown = i;
    }
  }
  const eyeV = 0.5 * (out[anchors.leftEye * 2 + 1]! + out[anchors.rightEye * 2 + 1]!);
  const eyeY = 0.5 * (positions[anchors.leftEye * 3 + 1]! + positions[anchors.rightEye * 3 + 1]!);
  const span = eyeV - out[crown * 2 + 1]!;
  const stretch = (eyeV - hairTopY) / span;
  if (!(span > 0) || !(stretch > 1) || stretch > MAX_HAIR_STRETCH) {
    return;
  }
  for (let i = 0; i < count; i += 1) {
    const above = eyeV - out[i * 2 + 1]!;
    if (positions[i * 3 + 1]! <= eyeY || above <= 0) {
      continue;
    }
    const t = Math.min(1, above / span);
    out[i * 2 + 1] = Math.max(hairTopY, eyeV - above * (1 + (stretch - 1) * t * t));
  }
}

/**
 * The wall colour behind the head: the median of the top rows of an RGBA
 * region (rows from y = 0), away from the head's central columns.
 */
export function wallColour(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  centreX: number,
  halfWidth: number,
): [number, number, number] | null {
  const samples: Array<[number, number, number]> = [];
  const rows = Math.min(height, Math.max(4, Math.round(height * 0.08)));
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < width; x += 3) {
      if (x < centreX - halfWidth * 1.5 || x > centreX + halfWidth * 1.5) {
        const i = (y * width + x) * 4;
        samples.push([rgba[i]!, rgba[i + 1]!, rgba[i + 2]!]);
      }
    }
  }
  if (samples.length < 16) {
    return null;
  }
  const median = (channel: 0 | 1 | 2): number => {
    const values = samples.map((sample) => sample[channel]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)]!;
  };
  return [median(0), median(1), median(2)];
}

/**
 * Hair top (pixel row) at or above `startY` in an RGBA region whose rows run
 * from y = 0: the highest row whose central columns differ from the wall,
 * scanning up until 6 wall rows in a row.
 */
export function hairTopFromPixels(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  centreX: number,
  halfWidth: number,
  startY: number,
  background: [number, number, number] | null = wallColour(rgba, width, height, centreX, halfWidth),
): number | null {
  const left = Math.max(0, Math.round(centreX - halfWidth));
  const right = Math.min(width - 1, Math.round(centreX + halfWidth));
  if (!background || right <= left) {
    return null;
  }
  let top: number | null = null;
  let quiet = 0;
  for (let y = Math.min(height - 1, Math.round(startY)); y >= 0; y -= 1) {
    let differs = 0;
    for (let x = left; x <= right; x += 1) {
      const i = (y * width + x) * 4;
      if (Math.hypot(rgba[i]! - background[0], rgba[i + 1]! - background[1], rgba[i + 2]! - background[2]) > BACKGROUND_DISTANCE) {
        differs += 1;
      }
    }
    if (differs / (right - left + 1) > 0.25) {
      top = y;
      quiet = 0;
    } else if (top !== null) {
      quiet += 1;
      if (quiet >= 6) {
        break;
      }
    }
  }
  return top;
}

/**
 * Hair top and wall colour from the frame region above the head crop
 * (`rows` rows of RGBA). Centred between the nose and the ears, so a profile
 * finds the crown rather than the front hairline. Pure, for tests and tools.
 */
export function analyseHeadRegion(
  rgba: ArrayLike<number>,
  width: number,
  rows: number,
  frameHeight: number,
  landmarks: OnDevicePhoto['landmarks'],
): { hairTopY: number | null; wall: [number, number, number] | null } {
  const nose = landmarks[POSE_NOSE];
  const leftEye = landmarks[POSE_LEFT_EYE];
  const rightEye = landmarks[POSE_RIGHT_EYE];
  if (!nose || !leftEye || !rightEye || nose.visibility < LANDMARK_VISIBLE || rows < 4) {
    return { hairTopY: null, wall: null };
  }
  const ears = [landmarks[POSE_LEFT_EAR], landmarks[POSE_RIGHT_EAR]]
    .filter((ear): ear is NonNullable<typeof ear> => ear !== undefined && ear.visibility >= LANDMARK_VISIBLE);
  const earX = ears.length > 0 ? ears.reduce((sum, ear) => sum + ear.x, 0) / ears.length : nose.x;
  const centreX = ((nose.x + earX) / 2) * width;
  const eyeSpan = Math.max(Math.abs(leftEye.x - rightEye.x) * width, width * 0.02);
  const halfWidth = Math.max(0.8 * eyeSpan, 0.5 * Math.abs(nose.x - earX) * width);
  const wall = wallColour(rgba, width, rows, centreX, halfWidth);
  if (!wall) {
    return { hairTopY: null, wall: null };
  }
  const eyeRow = Math.min(rows - 1, Math.round(Math.min(leftEye.y, rightEye.y) * frameHeight));
  const top = hairTopFromPixels(rgba, width, rows, centreX, halfWidth, eyeRow, wall);
  return { hairTopY: top === null ? null : top / frameHeight, wall };
}

export interface PhotoSkinAttributes {
  /** Texture coordinates (v up, three.js `flipY`) into the front frame. */
  uvFront: Float32Array;
  uvSide: Float32Array;
  /** Per vertex (front, side) photo weights, sharpened towards face-on. */
  weights: Float32Array;
  /** Per vertex 0-1: how much of the photo shows; the rest is `fillColor`. */
  confidence: Float32Array;
  /** Per vertex linear RGB of the smooth fill for what no photo saw. */
  fillColor: Float32Array;
  /** Linear RGB gain that brings the side photo to the front photo's exposure. */
  sideGain: [number, number, number];
  front: HeadAlignment | null;
  side: HeadAlignment | null;
}

export function buildPhotoSkinAttributes(
  positions: Float32Array,
  photoUv: MhrPhotoUv,
  front: PhotoFrameMeta,
  side: PhotoFrameMeta | null,
  triangles: ArrayLike<number>,
): PhotoSkinAttributes {
  const count = positions.length / 3;
  const anchors = findHeadAnchors(positions);
  const uvFront = new Float32Array(count * 2);
  const uvSide = new Float32Array(count * 2);
  const frontAlignment = frameUvForView(
    photoUv.front_uv,
    front,
    positions,
    anchors,
    uvFront,
    photoUv.front_weight,
  );
  const sideAlignment = side
    ? frameUvForView(photoUv.side_uv, side, positions, anchors, uvSide, photoUv.side_weight)
    : null;

  // Photo weights, the wall rejected on the head, sharpened towards face-on so
  // the view that sees a surface squarely wins (soft linear blends ghosted).
  const weights = new Float32Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    const wf = photoUv.front_weight[i]!;
    const ws = side ? photoUv.side_weight[i]! : 0;
    const f = wf < WALL_TEST_MAX_WEIGHT && onWall(front, uvFront, i) ? 0 : wf / 255;
    const sd = side && !(ws < WALL_TEST_MAX_WEIGHT && onWall(side, uvSide, i)) ? ws / 255 : 0;
    weights[i * 2] = f * f;
    weights[i * 2 + 1] = sd * sd;
  }

  const mesh = meshNeighbours(triangles, count);
  const confidence = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const seen = weights[i * 2]! + weights[i * 2 + 1]!;
    confidence[i] = Math.min(1, Math.max(0, (seen - 0.05) / 0.3));
  }
  featherConfidence(confidence, mesh);

  const sideGain = side ? fitSideGain(front, side, uvFront, uvSide, weights, count) : ([1, 1, 1] as [number, number, number]);
  const fillColor = diffuseFillColor(
    positions,
    anchors,
    front,
    side,
    uvFront,
    uvSide,
    weights,
    confidence,
    sideGain,
    mesh,
  );

  // Unseen vertices still need sane photo coordinates for the triangles they
  // share with seen ones; the colour there comes from the fill.
  fillUnseenFromNearestSeen(uvFront, uvSide, weights, triangles, count);

  // three.js textures are flipY: v runs up.
  for (let i = 0; i < count; i += 1) {
    uvFront[i * 2 + 1] = 1 - uvFront[i * 2 + 1]!;
    uvSide[i * 2 + 1] = 1 - uvSide[i * 2 + 1]!;
  }
  return {
    uvFront,
    uvSide,
    weights,
    confidence,
    fillColor,
    sideGain,
    front: frontAlignment,
    side: sideAlignment,
  };
}

interface MeshNeighbours {
  offsets: Uint32Array;
  neighbours: Uint32Array;
}

function meshNeighbours(triangles: ArrayLike<number>, count: number): MeshNeighbours {
  const offsets = new Uint32Array(count + 1);
  for (let i = 0; i < triangles.length; i += 1) {
    offsets[triangles[i]! + 1] += 2;
  }
  for (let i = 0; i < count; i += 1) {
    offsets[i + 1] += offsets[i]!;
  }
  const neighbours = new Uint32Array(offsets[count]!);
  const cursor = offsets.slice(0, count);
  const link = (from: number, to: number): void => {
    neighbours[cursor[from]!] = to;
    cursor[from] += 1;
  };
  for (let f = 0; f + 2 < triangles.length; f += 3) {
    const a = triangles[f]!;
    const b = triangles[f + 1]!;
    const c = triangles[f + 2]!;
    link(a, b);
    link(a, c);
    link(b, a);
    link(b, c);
    link(c, a);
    link(c, b);
  }
  return { offsets, neighbours };
}

/** Pull confidence down next to unseen vertices so the photo fades out, never cuts off. */
function featherConfidence(confidence: Float32Array, mesh: MeshNeighbours): void {
  const next = new Float32Array(confidence.length);
  for (let pass = 0; pass < CONFIDENCE_FEATHER_PASSES; pass += 1) {
    for (let i = 0; i < confidence.length; i += 1) {
      let sum = 0;
      let n = 0;
      for (let k = mesh.offsets[i]!; k < mesh.offsets[i + 1]!; k += 1) {
        sum += confidence[mesh.neighbours[k]!]!;
        n += 1;
      }
      next[i] = n > 0 ? Math.min(confidence[i]!, 0.5 * confidence[i]! + 0.5 * (sum / n)) : confidence[i]!;
    }
    confidence.set(next);
  }
}

function srgbToLinear(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear RGB of a 3x3 patch at frame-normalized (u, v), or null outside the frame. */
function samplePhoto(frame: PhotoFrameMeta, u: number, v: number): [number, number, number] | null {
  const pixels = frame.pixels;
  if (!pixels) {
    return null;
  }
  const cx = Math.round(u * pixels.width);
  const cy = Math.round(v * pixels.height);
  if (cx < 1 || cy < 1 || cx >= pixels.width - 1 || cy >= pixels.height - 1) {
    return null;
  }
  const out: [number, number, number] = [0, 0, 0];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const i = ((cy + dy) * pixels.width + cx + dx) * 4;
      out[0] += srgbToLinear(pixels.rgba[i]!);
      out[1] += srgbToLinear(pixels.rgba[i + 1]!);
      out[2] += srgbToLinear(pixels.rgba[i + 2]!);
    }
  }
  return [out[0] / 9, out[1] / 9, out[2] / 9];
}

/**
 * The two photos are taken seconds apart, often facing a window: exposure and
 * white balance differ, and the seam between them shows. Fit a per-channel
 * gain on the surface both photos see well.
 */
function fitSideGain(
  front: PhotoFrameMeta,
  side: PhotoFrameMeta,
  uvFront: Float32Array,
  uvSide: Float32Array,
  weights: Float32Array,
  count: number,
): [number, number, number] {
  const sumFront = [0, 0, 0];
  const sumSide = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < count; i += 1) {
    if (Math.sqrt(weights[i * 2]!) < BOTH_SEEN || Math.sqrt(weights[i * 2 + 1]!) < BOTH_SEEN) {
      continue;
    }
    const f = samplePhoto(front, uvFront[i * 2]!, uvFront[i * 2 + 1]!);
    const sd = samplePhoto(side, uvSide[i * 2]!, uvSide[i * 2 + 1]!);
    if (!f || !sd) {
      continue;
    }
    for (let c = 0; c < 3; c += 1) {
      sumFront[c] += f[c]!;
      sumSide[c] += sd[c]!;
    }
    n += 1;
  }
  if (n < 50) {
    return [1, 1, 1];
  }
  const gain = (c: number): number => Math.min(1.5, Math.max(0.67, sumFront[c]! / Math.max(sumSide[c]!, 1e-6)));
  return [gain(0), gain(1), gain(2)];
}

/**
 * Q6 "nearest seen colour", smooth: confidently seen vertices are seeds with
 * their photo colour; everything else diffuses from them across the mesh
 * (BFS start, then Laplacian passes), so the back reads as the shirt or
 * trousers rather than streaks of single texels. On the head, unseen vertices
 * above the ears are seeded with the measured hair colour, not the face.
 */
function diffuseFillColor(
  positions: Float32Array,
  anchors: HeadAnchors | null,
  front: PhotoFrameMeta,
  side: PhotoFrameMeta | null,
  uvFront: Float32Array,
  uvSide: Float32Array,
  weights: Float32Array,
  confidence: Float32Array,
  sideGain: [number, number, number],
  mesh: MeshNeighbours,
): Float32Array {
  const count = confidence.length;
  const color = new Float32Array(count * 3);
  const fixed = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) {
    if (confidence[i]! < CONFIDENT) {
      continue;
    }
    const wf = weights[i * 2]!;
    const ws = weights[i * 2 + 1]!;
    const f = wf > 0 ? samplePhoto(front, uvFront[i * 2]!, uvFront[i * 2 + 1]!) : null;
    const sd = side && ws > 0 ? samplePhoto(side, uvSide[i * 2]!, uvSide[i * 2 + 1]!) : null;
    const total = (f ? wf : 0) + (sd ? ws : 0);
    if (total <= 0) {
      continue;
    }
    for (let c = 0; c < 3; c += 1) {
      color[i * 3 + c] = ((f ? f[c]! * wf : 0) + (sd ? sd[c]! * sideGain[c]! * ws : 0)) / total;
    }
    fixed[i] = 1;
  }

  const hair = anchors ? hairColour(front) : null;
  if (anchors && hair) {
    let crownY = -Infinity;
    for (let i = 0; i < count; i += 1) {
      crownY = Math.max(crownY, positions[i * 3 + 1]!);
    }
    const eyeY = 0.5 * (positions[anchors.leftEye * 3 + 1]! + positions[anchors.rightEye * 3 + 1]!);
    const hairLine = eyeY + 0.3 * (crownY - eyeY);
    for (let i = 0; i < count; i += 1) {
      if (!fixed[i] && positions[i * 3 + 1]! > hairLine) {
        color.set(hair, i * 3);
        fixed[i] = 1;
      }
    }
  }

  // Start every free vertex at its nearest seed, then relax.
  const queue = new Uint32Array(count);
  const reached = new Uint8Array(count);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < count; i += 1) {
    if (fixed[i]) {
      queue[tail] = i;
      tail += 1;
      reached[i] = 1;
    }
  }
  while (head < tail) {
    const vertex = queue[head]!;
    head += 1;
    for (let k = mesh.offsets[vertex]!; k < mesh.offsets[vertex + 1]!; k += 1) {
      const next = mesh.neighbours[k]!;
      if (!reached[next]) {
        reached[next] = 1;
        color.copyWithin(next * 3, vertex * 3, vertex * 3 + 3);
        queue[tail] = next;
        tail += 1;
      }
    }
  }
  const scratch = new Float32Array(color.length);
  for (let pass = 0; pass < FILL_DIFFUSION_PASSES; pass += 1) {
    for (let i = 0; i < count; i += 1) {
      if (fixed[i]) {
        scratch[i * 3] = color[i * 3]!;
        scratch[i * 3 + 1] = color[i * 3 + 1]!;
        scratch[i * 3 + 2] = color[i * 3 + 2]!;
        continue;
      }
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let k = mesh.offsets[i]!; k < mesh.offsets[i + 1]!; k += 1) {
        const j = mesh.neighbours[k]!;
        r += color[j * 3]!;
        g += color[j * 3 + 1]!;
        b += color[j * 3 + 2]!;
        n += 1;
      }
      scratch[i * 3] = n > 0 ? r / n : color[i * 3]!;
      scratch[i * 3 + 1] = n > 0 ? g / n : color[i * 3 + 1]!;
      scratch[i * 3 + 2] = n > 0 ? b / n : color[i * 3 + 2]!;
    }
    color.set(scratch);
  }
  return color;
}

/** Linear RGB median of the hair just under the hair top, or null without one. */
function hairColour(frame: PhotoFrameMeta): [number, number, number] | null {
  const pixels = frame.pixels;
  const nose = frame.landmarks[POSE_NOSE];
  const leftEye = frame.landmarks[POSE_LEFT_EYE];
  const rightEye = frame.landmarks[POSE_RIGHT_EYE];
  if (!pixels || frame.hairTopY === null || frame.hairTopY === undefined || !nose || !leftEye || !rightEye) {
    return null;
  }
  const top = Math.round(frame.hairTopY * pixels.height);
  const eyeRow = Math.round(Math.min(leftEye.y, rightEye.y) * pixels.height);
  const bottom = Math.round(top + 0.35 * (eyeRow - top));
  const half = Math.max(2, Math.round(0.5 * Math.abs(leftEye.x - rightEye.x) * pixels.width));
  const cx = Math.round(nose.x * pixels.width);
  const samples: Array<[number, number, number]> = [];
  for (let y = Math.max(0, top); y < Math.min(pixels.height, bottom); y += 1) {
    for (let x = Math.max(0, cx - half); x < Math.min(pixels.width, cx + half); x += 1) {
      const i = (y * pixels.width + x) * 4;
      samples.push([pixels.rgba[i]!, pixels.rgba[i + 1]!, pixels.rgba[i + 2]!]);
    }
  }
  if (samples.length < 9) {
    return null;
  }
  const median = (c: 0 | 1 | 2): number => srgbToLinear(samples.map((sample) => sample[c]).sort((a, b) => a - b)[samples.length >> 1]!);
  return [median(0), median(1), median(2)];
}

/** A head vertex (above the crop) whose pixel in this frame is the wall behind the shopper. */
function onWall(frame: PhotoFrameMeta, uv: Float32Array, vertex: number): boolean {
  const pixels = frame.pixels;
  const wall = frame.wall;
  if (!pixels || !wall) {
    return false;
  }
  const x = Math.floor(uv[vertex * 2]! * pixels.width);
  const y = Math.floor(uv[vertex * 2 + 1]! * pixels.height);
  const cropRow = Math.floor((frame.keepBox.y / frame.height) * pixels.height);
  if (y >= cropRow || x < 0 || x >= pixels.width) {
    return false;
  }
  if (y < 0) {
    return true; // above the frame: nothing of the shopper there
  }
  const i = (y * pixels.width + x) * 4;
  return Math.hypot(pixels.rgba[i]! - wall[0], pixels.rgba[i + 1]! - wall[1], pixels.rgba[i + 2]! - wall[2])
    < BACKGROUND_DISTANCE;
}

/**
 * Q6 "nearest seen colour": a vertex neither photo sees (the back, the back of
 * the head, edges outside the person's outline) takes the photo coordinates
 * and weights of the nearest seen vertex across the body surface
 * (multi-source breadth-first over the mesh). Projecting straight through the
 * body instead put the shirt's buttons on the back and the face on the back
 * of the head.
 */
export function fillUnseenFromNearestSeen(
  uvFront: Float32Array,
  uvSide: Float32Array,
  weights: Float32Array,
  triangles: ArrayLike<number>,
  count: number,
): void {
  const offsets = new Uint32Array(count + 1);
  for (let i = 0; i < triangles.length; i += 1) {
    offsets[triangles[i]! + 1] += 2;
  }
  for (let i = 0; i < count; i += 1) {
    offsets[i + 1] += offsets[i]!;
  }
  const neighbours = new Uint32Array(offsets[count]!);
  const cursor = offsets.slice(0, count);
  const link = (from: number, to: number): void => {
    neighbours[cursor[from]!] = to;
    cursor[from] += 1;
  };
  for (let f = 0; f + 2 < triangles.length; f += 3) {
    const a = triangles[f]!;
    const b = triangles[f + 1]!;
    const c = triangles[f + 2]!;
    link(a, b);
    link(a, c);
    link(b, a);
    link(b, c);
    link(c, a);
    link(c, b);
  }

  const source = new Int32Array(count).fill(-1);
  const queue = new Uint32Array(count);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < count; i += 1) {
    if (weights[i * 2]! + weights[i * 2 + 1]! > 0) {
      source[i] = i;
      queue[tail] = i;
      tail += 1;
    }
  }
  while (head < tail) {
    const vertex = queue[head]!;
    head += 1;
    for (let k = offsets[vertex]!; k < offsets[vertex + 1]!; k += 1) {
      const next = neighbours[k]!;
      if (source[next]! < 0) {
        source[next] = source[vertex]!;
        queue[tail] = next;
        tail += 1;
      }
    }
  }
  for (let i = 0; i < count; i += 1) {
    const from = source[i]!;
    if (from === i) {
      continue;
    }
    if (from < 0) {
      weights[i * 2] = UNSEEN_WEIGHT;
      continue;
    }
    uvFront[i * 2] = uvFront[from * 2]!;
    uvFront[i * 2 + 1] = uvFront[from * 2 + 1]!;
    uvSide[i * 2] = uvSide[from * 2]!;
    uvSide[i * 2 + 1] = uvSide[from * 2 + 1]!;
    weights[i * 2] = weights[from * 2]!;
    weights[i * 2 + 1] = weights[from * 2 + 1]!;
  }
}

/**
 * The shopper's skin colour from their own face, on this device only:
 * forehead and both cheekbones (clear of most beards and fringes). Hair, beard
 * and glare are trimmed by brightness before the per-channel median.
 * `pixels` is RGBA. Returns sRGB 0-255, or null with too little skin.
 */
export function skinColorFromPixels(pixels: Uint8ClampedArray): [number, number, number] | null {
  const samples: Array<[number, number, number, number]> = [];
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3]! < 255) {
      continue; // outside the frame (transparent), never skin
    }
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    samples.push([0.2126 * r + 0.7152 * g + 0.0722 * b, r, g, b]);
  }
  if (samples.length < 24) {
    return null;
  }
  samples.sort((p, q) => p[0] - q[0]);
  const kept = samples.slice(Math.floor(samples.length * 0.35), Math.ceil(samples.length * 0.95));
  const median = (channel: 1 | 2 | 3): number => {
    const values = kept.map((sample) => sample[channel]).sort((p, q) => p - q);
    return values[Math.floor(values.length / 2)]!;
  };
  return [median(1), median(2), median(3)];
}

/** Where to read skin in a front frame (pixel rects), from its face landmarks. */
export function skinPatches(frame: PhotoFrameMeta): Array<{ x: number; y: number; size: number }> {
  const at = (index: number): { x: number; y: number } | null => {
    const landmark = frame.landmarks[index];
    return landmark && landmark.visibility >= LANDMARK_VISIBLE
      ? { x: landmark.x * frame.width, y: landmark.y * frame.height }
      : null;
  };
  const leftEye = at(POSE_LEFT_EYE);
  const rightEye = at(POSE_RIGHT_EYE);
  const mouthLeft = at(POSE_MOUTH_LEFT);
  const mouthRight = at(POSE_MOUTH_RIGHT);
  if (!leftEye || !rightEye || !mouthLeft || !mouthRight) {
    return [];
  }
  const eyeY = (leftEye.y + rightEye.y) / 2;
  const faceHeight = (mouthLeft.y + mouthRight.y) / 2 - eyeY;
  if (faceHeight <= 2) {
    return [];
  }
  const size = Math.max(3, Math.round(faceHeight * 0.32));
  const midX = (leftEye.x + rightEye.x) / 2;
  return [
    { x: midX, y: eyeY - faceHeight * 0.6 },
    { x: leftEye.x, y: eyeY + faceHeight * 0.42 },
    { x: rightEye.x, y: eyeY + faceHeight * 0.42 },
  ]
    .map((centre) => ({ x: Math.round(centre.x - size / 2), y: Math.round(centre.y - size / 2), size }))
    .filter((patch) => patch.x >= 0 && patch.y >= 0
      && patch.x + patch.size <= frame.width && patch.y + patch.size <= frame.height);
}

export function sampleSkinColor(frame: PhotoFrameMeta): [number, number, number] | null {
  const pixels = frame.pixels;
  if (!pixels) {
    return null;
  }
  const chunks: number[] = [];
  for (const patch of skinPatches(frame)) {
    const scaleX = pixels.width / frame.width;
    const scaleY = pixels.height / frame.height;
    for (let y = Math.round(patch.y * scaleY); y < Math.round((patch.y + patch.size) * scaleY); y += 1) {
      for (let x = Math.round(patch.x * scaleX); x < Math.round((patch.x + patch.size) * scaleX); x += 1) {
        const i = (y * pixels.width + x) * 4;
        chunks.push(pixels.rgba[i]!, pixels.rgba[i + 1]!, pixels.rgba[i + 2]!, pixels.rgba[i + 3]!);
      }
    }
  }
  return skinColorFromPixels(new Uint8ClampedArray(chunks));
}

/**
 * Everything painting needs from one on-device frame, with its pixels read
 * once. Call `releaseFrameMeta` when painting is done: the copy holds the
 * shopper's face.
 */
export function photoFrameMeta(photo: OnDevicePhoto): PhotoFrameMeta {
  const { frame } = photo;
  const context = frame.getContext('2d', { willReadFrequently: true });
  const rgba = context && frame.width > 0 && frame.height > 0
    ? context.getImageData(0, 0, frame.width, frame.height).data
    : null;
  const pixels = rgba ? { rgba, width: frame.width, height: frame.height } : null;
  const rows = Math.max(0, Math.min(frame.height, Math.floor(photo.keepBox.y)));
  const head = rgba && rows >= 4
    ? analyseHeadRegion(rgba, frame.width, rows, frame.height, photo.landmarks)
    : { hairTopY: null, wall: null };
  return {
    keepBox: photo.keepBox,
    width: frame.width,
    height: frame.height,
    landmarks: photo.landmarks,
    pixels,
    ...head,
  };
}

/** Wipe the frame copy (it holds the shopper's face) as soon as painting is done. */
export function releaseFrameMeta(frame: PhotoFrameMeta | null): void {
  frame?.pixels?.rgba.fill(0);
}

/**
 * Unlit photo material: the frames already carry real light, so only a soft
 * facing term keeps the 3D form readable. Textures are disposed with it.
 */
export function createPhotoSkinMaterial(
  geometry: THREE.BufferGeometry,
  attributes: PhotoSkinAttributes,
  front: OnDevicePhoto,
  side: OnDevicePhoto | null,
): THREE.MeshBasicMaterial {
  geometry.setAttribute('uvFront', new THREE.Float32BufferAttribute(attributes.uvFront, 2));
  geometry.setAttribute('uvSide', new THREE.Float32BufferAttribute(attributes.uvSide, 2));
  geometry.setAttribute('photoWeight', new THREE.Float32BufferAttribute(attributes.weights, 2));
  geometry.setAttribute('photoConfidence', new THREE.Float32BufferAttribute(attributes.confidence, 1));
  geometry.setAttribute('fillColor', new THREE.Float32BufferAttribute(attributes.fillColor, 3));
  const vertexCount = attributes.weights.length / 2;
  geometry.setAttribute('skinFill', new THREE.Float32BufferAttribute(new Float32Array(vertexCount), 1));

  const frontTexture = new THREE.CanvasTexture(front.frame);
  const sideTexture = side ? new THREE.CanvasTexture(side.frame) : frontTexture;
  for (const texture of new Set([frontTexture, sideTexture])) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.anisotropy = 4;
  }

  // Photo colours are already display colours: no tone mapping on top.
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const skinColor = new THREE.Color(0xc89a7c);
  material.userData.skinColor = skinColor;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.photoFront = { value: frontTexture };
    shader.uniforms.photoSide = { value: sideTexture };
    shader.uniforms.skinColor = { value: skinColor };
    shader.uniforms.sideGain = { value: new THREE.Vector3(...attributes.sideGain) };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 uvFront;
attribute vec2 uvSide;
attribute vec2 photoWeight;
attribute float skinFill;
attribute float photoConfidence;
attribute vec3 fillColor;
varying float vPhotoConfidence;
varying vec3 vFillColor;
varying vec2 vUvFront;
varying vec2 vUvSide;
varying vec2 vPhotoWeight;
varying vec3 vPhotoNormal;
varying float vSkinFill;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vSkinFill = skinFill;
vPhotoConfidence = photoConfidence;
vFillColor = fillColor;
vUvFront = uvFront;
vUvSide = uvSide;
vPhotoWeight = photoWeight;
vPhotoNormal = normalize(mat3(modelMatrix) * normal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D photoFront;
uniform sampler2D photoSide;
uniform vec3 skinColor;
uniform vec3 sideGain;
varying float vPhotoConfidence;
varying vec3 vFillColor;
varying vec2 vUvFront;
varying vec2 vUvSide;
varying vec2 vPhotoWeight;
varying vec3 vPhotoNormal;
varying float vSkinFill;`,
      )
      .replace(
        '#include <map_fragment>',
        `vec3 photoFrontRgb = texture2D(photoFront, vUvFront).rgb;
vec3 photoSideRgb = texture2D(photoSide, vUvSide).rgb;
float photoWeightSum = max(vPhotoWeight.x + vPhotoWeight.y, 1e-4);
vec3 photoRgb = (photoFrontRgb * vPhotoWeight.x + photoSideRgb * sideGain * vPhotoWeight.y) / photoWeightSum;
photoRgb = mix(vFillColor, photoRgb, clamp(vPhotoConfidence, 0.0, 1.0));
photoRgb = mix(photoRgb, skinColor, clamp(vSkinFill, 0.0, 1.0));
// A soft fixed key light (world space) so the form reads like the garment
// next to it; the photos already carry real light, so it stays gentle.
float photoShade = 0.8 + 0.22 * max(dot(normalize(vPhotoNormal), normalize(vec3(0.35, 0.75, 0.55))), 0.0);
diffuseColor.rgb *= photoRgb * photoShade;`,
      );
  };
  material.customProgramCacheKey = () => 'ashrium-photo-skin-v3';
  const dispose = material.dispose.bind(material);
  material.dispose = () => {
    frontTexture.dispose();
    if (sideTexture !== frontTexture) {
      sideTexture.dispose();
    }
    dispose();
  };
  return material;
}

/**
 * Show skin instead of the shopper's own clothes on `mask` (1 = replaced) in
 * `color` (sRGB 0-255), or restore the photo everywhere with `mask` null.
 */
export function setPhotoSkinFill(
  mesh: THREE.Mesh,
  mask: Float32Array | null,
  color: [number, number, number] | null,
): void {
  const attribute = mesh.geometry.getAttribute('skinFill');
  const material = mesh.material;
  if (!(attribute instanceof THREE.BufferAttribute) || Array.isArray(material)) {
    return;
  }
  const values = attribute.array as Float32Array;
  if (mask && mask.length === values.length) {
    values.set(mask);
  } else {
    values.fill(0);
  }
  attribute.needsUpdate = true;
  const skinColor = material.userData.skinColor;
  if (color && skinColor instanceof THREE.Color) {
    skinColor.setRGB(color[0] / 255, color[1] / 255, color[2] / 255, THREE.SRGBColorSpace);
  }
}
