'use client';

import { useEffect, useMemo, useRef, useState, type FC } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import type { AnnyCanvasGarment, PaintUnavailableReason } from '@/components/vfr/anny-canvas';
import { fitSummaryLine, summarizeFit } from '@/lib/fit/fit-summary';
import { findMhrHullMesh, vertexBufferToMeters } from '@/lib/graphics/anny-hull';
import { BODY_PART, bodyHeights, loadBodyParts, replacedClothes, vertexFillZones } from '@/lib/graphics/body-parts';
import { FILL_ZONE, certainBodyArea, headIsCovered, removeReplacedClothes } from '@/lib/graphics/clothes-removal';
import {
  foldOcclusion,
  formNormals,
  openEdgeRim,
  seamSmoothNormals,
} from '@/lib/graphics/cloth-shading';
import { photoShading } from '@/lib/graphics/photo-shading';
import {
  fitPhotoLighting,
  lightForShader,
  lightingAt,
  srgbToLinear,
  type PhotoLighting,
} from '@/lib/graphics/photo-lighting';
import { closeGarmentGaps, collarGapBand, trimGarmentSpikes } from '@/lib/graphics/garment-gaps';
import { compositeSimPositions, decodeSimDelta, simDeltaFromBase64 } from '@/lib/graphics/meshopt-delta';
import {
  bodyFramePixels,
  createPatchProjector,
  sideCameraSign,
  viewDepth,
  type MirrorView as MirrorViewName,
} from '@/lib/graphics/mirror-projection';
import { evaluatePrintQaFromImage, type PrintQaResult } from '@/lib/graphics/print-qa';
import { DEFAULT_EASE_CM, mapRadialClearanceToColor } from '@/lib/graphics/radial-heatmap';
import { preloadClothesSegmenter, resizeMask, segmentPerson, type PersonMasks } from '@/lib/widget/clothes-segmenter';
import type { OnDevicePhoto, OnDevicePhotos } from '@/lib/widget/webp-encode';
import type { SimDrapeMesh } from '@/types/graphics';
import { MHR_HULL_GLB_PUBLIC_PATH, MHR_VERTEX_COUNT, type FitParametricVector } from '@/types/hmr';

/**
 * The shopper's result: their own photo (front or side), the garment they
 * chose drawn in where Newton draped it on their fitted body. Where the new
 * garment covers less than what they wore, their own clothes are taken out
 * and filled from their own skin, trousers and background (owner 2026-10-11,
 * replaces Q16; `lib/graphics/clothes-removal.ts`). The photos never leave
 * this device; everything here runs in the browser.
 */
export interface MirrorViewProps {
  parametric: FitParametricVector;
  photos: OnDevicePhotos | null;
  garment?: AnnyCanvasGarment | null;
  /** Base64 sim delta from /api/v1/fit/resolve (sewn drape, v3). */
  drapePayloadBase64?: string | null;
  showClearanceHeatmap?: boolean;
  revealed?: boolean;
  onBodyReady?: () => void;
  onPrintQaFail?: () => void;
  onFitSummary?: (line: string | null) => void;
  onPaintUnavailable?: (reason: PaintUnavailableReason) => void;
  /** The drape is drawn into the photo (true) or could not be drawn (false). */
  onGarmentShown?: (shown: boolean) => void;
  className?: string;
}

/** The fitted arm is trusted over the mask this far inside its outline, and this far clear of the head (crop height). */
const BODY_CERTAIN_INSET = 0.004;
const BODY_CERTAIN_HEAD_CLEARANCE = 0.06;

/** Smoothing of the photo's light (fraction of the crop height): past the old garment's own folds, so only the light across the body is kept. */
const PHOTO_LIGHT_RADIUS = 0.035;

/** Light softness when the photo's own light cannot be read (the old fixed key light). */
const DEFAULT_AMBIENT_SHARE = 0.42;

/** Fallback fabric when the product image gives no colour (print QA off). */
const NEUTRAL_FABRIC = new THREE.Color().setRGB(0.32, 0.33, 0.36, THREE.SRGBColorSpace);
/** Space around the shopper in the cropped photo (fraction of their height). */
const CROP_MARGIN = 0.08;

interface BodyAssets {
  positions: Float32Array;
  triangles: Uint32Array;
  normals: Float32Array;
  parts: Uint8Array | null;
  /** `FILL_ZONE` per vertex; null without part labels (no clothes removal). */
  zones: Uint8Array | null;
}

interface BodyZones {
  zone: Uint8Array;
  facing: Float32Array;
  /** 1 on the fitted head (face, hair, ears), never the hands or feet. */
  head: Uint8Array;
  /** View-space body normal per pixel (3 each; 0 off the body). */
  normal: Float32Array;
}

interface PhotoCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Collar gaps (fraction of the crop height): how narrow a gap is closed, and how far from the head. */
const COLLAR_GAP_RADIUS = 0.008;
const COLLAR_BAND_REACH = 0.05;
/** The inside of the back collar, seen over the shoulder, sits in its own shade. */
const INSIDE_FABRIC_SHADE = 0.86;

/** Longest edge the clothes masks are computed at (masks are smooth; the fill runs at full size). */
const SEGMENT_MAX_EDGE_PX = 1024;

/** The shopper (their projected body) with a margin, from the top of the frame, inside the frame. */
function photoCrop(pixels: Float32Array, frame: HTMLCanvasElement): PhotoCrop | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pixels.length; i += 2) {
    minX = Math.min(minX, pixels[i]);
    maxX = Math.max(maxX, pixels[i]);
    minY = Math.min(minY, pixels[i + 1]);
    maxY = Math.max(maxY, pixels[i + 1]);
  }
  const margin = CROP_MARGIN * (maxY - minY);
  const crop = {
    x: Math.max(0, Math.floor(minX - margin)),
    // From the top of the frame: the shopper's whole head and face stay in
    // their photo (the fitted body is measured from the headless copy, so
    // cropping to it cut the head off). On this device only.
    y: 0,
    w: 0,
    h: 0,
  };
  crop.w = Math.min(frame.width, Math.ceil(maxX + margin)) - crop.x;
  crop.h = Math.min(frame.height, Math.ceil(maxY + margin)) - crop.y;
  return crop.w > 0 && crop.h > 0 ? crop : null;
}

/** Mean crop row of the body vertices at a canonical height (± 1.5 cm). */
function rowAtHeight(body: BodyAssets, pixels: Float32Array, y: number, cropY: number): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < body.positions.length / 3; i += 1) {
    if (Math.abs(body.positions[i * 3 + 1] - y) <= 0.015 && body.zones?.[i] !== FILL_ZONE.keep) {
      sum += pixels[i * 2 + 1];
      count += 1;
    }
  }
  return count > 0 ? sum / count - cropY : NaN;
}

/** Segment the cropped photo at a bounded size, then bring the masks back to the crop's size. */
async function segmentCrop(photo: OnDevicePhoto, crop: PhotoCrop): Promise<PersonMasks> {
  const scale = Math.min(1, SEGMENT_MAX_EDGE_PX / Math.max(crop.w, crop.h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(crop.w * scale));
  canvas.height = Math.max(1, Math.round(crop.h * scale));
  try {
    canvas.getContext('2d')?.drawImage(photo.frame, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
    const masks = await segmentPerson(canvas);
    return {
      width: crop.w,
      height: crop.h,
      clothes: resizeMask(masks.clothes, masks.width, masks.height, crop.w, crop.h),
      background: resizeMask(masks.background, masks.width, masks.height, crop.w, crop.h),
      skin: resizeMask(masks.skin, masks.width, masks.height, crop.w, crop.h),
    };
  } finally {
    canvas.width = 0;
  }
}

/**
 * The fitted body drawn into the photo: one `FILL_ZONE` per pixel (off the
 * body → outside) and how squarely the body faces the camera there. Zones are
 * flat per triangle, so they never blend into a third one; a triangle keeps
 * the photo only when all its corners do, so a collar or cuff at the edge of
 * the face or a foot can still go.
 */
function renderBodyZones(
  renderer: THREE.WebGLRenderer,
  camera: THREE.Camera,
  occluderPositions: Float32Array,
  triangles: Uint32Array,
  zones: Uint8Array,
  facingPerVertex: Float32Array,
  normalPerVertex: Float32Array,
  parts: Uint8Array | null,
  crop: PhotoCrop,
): BodyZones {
  const corners = triangles.length;
  const positions = new Float32Array(corners * 3);
  const colours = new Float32Array(corners * 3);
  for (let t = 0; t < corners; t += 3) {
    const corner = [zones[triangles[t]], zones[triangles[t + 1]], zones[triangles[t + 2]]];
    const isHead = parts !== null
      && parts[triangles[t]] === BODY_PART.head
      && parts[triangles[t + 1]] === BODY_PART.head
      && parts[triangles[t + 2]] === BODY_PART.head;
    const open = corner.filter((value) => value !== FILL_ZONE.keep);
    const zone = open.length === 0 ? FILL_ZONE.keep : Math.max(...open);
    for (let k = 0; k < 3; k += 1) {
      const vertex = triangles[t + k];
      positions.set(occluderPositions.subarray(vertex * 3, vertex * 3 + 3), (t + k) * 3);
      colours[(t + k) * 3] = (zone + 1) / 8;
      colours[(t + k) * 3 + 1] = facingPerVertex[vertex];
      colours[(t + k) * 3 + 2] = isHead ? 1 : 0;
    }
  }
  // Smooth view-space normals (x right, y up, z toward the camera), 0.5-centred.
  const normalColours = new Float32Array(corners * 3);
  for (let t = 0; t < corners; t += 1) {
    const vertex = triangles[t];
    for (let c = 0; c < 3; c += 1) {
      normalColours[t * 3 + c] = normalPerVertex[vertex * 3 + c] * 0.5 + 0.5;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, material));
  const target = new THREE.WebGLRenderTarget(crop.w, crop.h);
  const read = new Uint8Array(crop.w * crop.h * 4);
  const readNormals = new Uint8Array(crop.w * crop.h * 4);
  try {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, crop.w, crop.h, read);
    geometry.setAttribute('color', new THREE.BufferAttribute(normalColours, 3));
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, crop.w, crop.h, readNormals);
  } finally {
    renderer.setRenderTarget(null);
    target.dispose();
    geometry.dispose();
    material.dispose();
  }
  const zone = new Uint8Array(crop.w * crop.h);
  const facing = new Float32Array(crop.w * crop.h);
  const head = new Uint8Array(crop.w * crop.h);
  const normal = new Float32Array(crop.w * crop.h * 3);
  for (let y = 0; y < crop.h; y += 1) {
    // Render targets read bottom row first.
    const source = (crop.h - 1 - y) * crop.w;
    for (let x = 0; x < crop.w; x += 1) {
      const pixel = y * crop.w + x;
      const red = read[(source + x) * 4];
      zone[pixel] = red === 0 ? FILL_ZONE.outside : Math.max(0, Math.round((red / 255) * 8) - 1);
      facing[pixel] = read[(source + x) * 4 + 1] / 255;
      head[pixel] = read[(source + x) * 4 + 2] > 127 ? 1 : 0;
      if (red !== 0) {
        const nx = readNormals[(source + x) * 4] / 127.5 - 1;
        const ny = readNormals[(source + x) * 4 + 1] / 127.5 - 1;
        const nz = readNormals[(source + x) * 4 + 2] / 127.5 - 1;
        const length = Math.hypot(nx, ny, nz) || 1;
        normal[pixel * 3] = nx / length;
        normal[pixel * 3 + 1] = ny / length;
        normal[pixel * 3 + 2] = nz / length;
      }
    }
  }
  return { zone, facing, head, normal };
}

/**
 * The photo's light, fitted on the shopper's visible skin (sure skin, on the
 * body, not under the new garment), sampled every other pixel.
 */
function fitSkinLight(photo: Uint8ClampedArray, zones: BodyZones, skin: Float32Array, width: number): PhotoLighting | null {
  const normals: number[] = [];
  const luminance: number[] = [];
  for (let pixel = 0; pixel < zones.zone.length; pixel += 2) {
    if (zones.zone[pixel] === FILL_ZONE.outside || skin[pixel] < 0.6 || pixel % width === 0) {
      continue;
    }
    normals.push(zones.normal[pixel * 3], zones.normal[pixel * 3 + 1], zones.normal[pixel * 3 + 2]);
    luminance.push(
      0.2126 * srgbToLinear(photo[pixel * 4]) + 0.7152 * srgbToLinear(photo[pixel * 4 + 1]) + 0.0722 * srgbToLinear(photo[pixel * 4 + 2]),
    );
  }
  return fitPhotoLighting(Float32Array.from(normals), Float32Array.from(luminance));
}

/** The fitted light's brightness on every body pixel (0 off the body). */
function skinLightMap(lighting: PhotoLighting, zones: BodyZones): Float32Array {
  const light = new Float32Array(zones.zone.length);
  for (let pixel = 0; pixel < light.length; pixel += 1) {
    if (zones.zone[pixel] !== FILL_ZONE.outside) {
      light[pixel] = lightingAt(lighting, zones.normal[pixel * 3], zones.normal[pixel * 3 + 1], zones.normal[pixel * 3 + 2]);
    }
  }
  return light;
}

/** A camera frame is never pin-sharp: the garment is drawn with this much softness (px). */
const GARMENT_SOFTNESS_PX = 0.6;
/** Pixels more saturated than this are coloured, not lit white. */
const NEUTRAL_SATURATION = 0.2;

/**
 * The colour of the room's light, from the photo's brightest near-neutral
 * surfaces (a white shirt, a pale wall: a white patch takes the light's
 * colour), never from a coloured garment. Unit brightness, within ±10%.
 */
function photoLightTint(photo: Uint8ClampedArray): [number, number, number] {
  const bright: Array<[number, number]> = [];
  for (let pixel = 0; pixel < photo.length / 4; pixel += 3) {
    const r = photo[pixel * 4];
    const g = photo[pixel * 4 + 1];
    const b = photo[pixel * 4 + 2];
    const max = Math.max(r, g, b);
    if (max < 60 || max >= 254 || (max - Math.min(r, g, b)) / max > NEUTRAL_SATURATION) {
      continue;
    }
    bright.push([pixel, r + g + b]);
  }
  if (bright.length < 200) {
    return [1, 1, 1];
  }
  bright.sort((x, y) => y[1] - x[1]);
  const sum = [0, 0, 0];
  for (const [pixel] of bright.slice(0, Math.max(50, Math.floor(bright.length * 0.2)))) {
    for (let c = 0; c < 3; c += 1) {
      sum[c] += srgbToLinear(photo[pixel * 4 + c]);
    }
  }
  const mean = (sum[0] + sum[1] + sum[2]) / 3 || 1;
  return sum.map((value) => Math.min(1.1, Math.max(0.9, value / mean))) as [number, number, number];
}

/** The photo's sensor grain: spread of the wall's fine detail (0-255 units), 0 when unknown. */
function photoGrain(photo: Uint8ClampedArray, background: Float32Array | null, width: number, height: number): number {
  if (!background) {
    return 0;
  }
  const residuals: number[] = [];
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const pixel = y * width + x;
      if (background[pixel] < 0.8) {
        continue;
      }
      const luma = (index: number): number => 0.299 * photo[index * 4] + 0.587 * photo[index * 4 + 1] + 0.114 * photo[index * 4 + 2];
      residuals.push(Math.abs(luma(pixel) - (luma(pixel - 1) + luma(pixel + 1) + luma(pixel - width) + luma(pixel + width)) / 4));
    }
  }
  if (residuals.length < 500) {
    return 0;
  }
  residuals.sort((a, b) => a - b);
  return Math.min(6, 1.4826 * (residuals[Math.floor(residuals.length / 2)] ?? 0));
}

/** The photo's grain over the drawn garment only. */
function addGarmentGrain(
  context: CanvasRenderingContext2D,
  layer: HTMLCanvasElement,
  width: number,
  height: number,
  grain: number,
): void {
  const coverage = layer.getContext('2d')?.getImageData(0, 0, width, height).data;
  if (!coverage) {
    return;
  }
  const image = context.getImageData(0, 0, width, height);
  let seed = 1234567;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const alpha = coverage[pixel * 4 + 3] / 255;
    if (alpha <= 0) {
      continue;
    }
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const noise = ((seed / 0x7fffffff) - 0.5) * 2 * grain * alpha;
    for (let c = 0; c < 3; c += 1) {
      image.data[pixel * 4 + c] = Math.max(0, Math.min(255, image.data[pixel * 4 + c] + noise));
    }
  }
  context.putImageData(image, 0, 0);
}

/** The photo's relative light as a texture the garment shader reads at its own pixel (rows bottom-up, halved). */
function shadingDataTexture(shading: Float32Array, width: number, height: number): THREE.DataTexture {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const source = (height - 1 - y) * width;
    for (let x = 0; x < width; x += 1) {
      data[y * width + x] = Math.round(Math.min(1, shading[source + x] / 2) * 255);
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Alpha channel of a drawn canvas (the garment's coverage), one byte per pixel. */
function canvasAlpha(source: HTMLCanvasElement, width: number, height: number): Uint8Array {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context?.drawImage(source, 0, 0);
  const data = context?.getImageData(0, 0, width, height).data;
  canvas.width = 0;
  const alpha = new Uint8Array(width * height);
  if (data) {
    for (let i = 0; i < alpha.length; i += 1) {
      alpha[i] = data[i * 4 + 3];
    }
  }
  return alpha;
}

/** A network blip must not send the shopper back to the camera: retry the static assets. */
async function withRetries<T>(load: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await load();
    } catch (error) {
      if (attempt >= attempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
    }
  }
}

function loadBodyTriangles(): Promise<Uint32Array> {
  return withRetries(() => new GLTFLoader().loadAsync(MHR_HULL_GLB_PUBLIC_PATH)).then((gltf) => {
    const mesh = findMhrHullMesh(gltf.scene);
    const index = mesh?.geometry.getIndex();
    if (!mesh || !index) {
      throw new Error('MHR hull has no triangles.');
    }
    const triangles = Uint32Array.from(index.array as ArrayLike<number>);
    gltf.scene.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose();
      }
    });
    return triangles;
  });
}

function inspectAlbedo(url: string): Promise<PrintQaResult> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      let pixels: Uint8ClampedArray | undefined;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.min(96, image.naturalWidth));
        canvas.height = Math.max(1, Math.min(96, image.naturalHeight));
        const context = canvas.getContext('2d');
        context?.drawImage(image, 0, 0, canvas.width, canvas.height);
        pixels = context?.getImageData(0, 0, canvas.width, canvas.height).data;
      } catch {
        pixels = undefined;
      }
      resolve(evaluatePrintQaFromImage({ width: image.naturalWidth, height: image.naturalHeight, pixels }));
    };
    image.onerror = () => resolve(evaluatePrintQaFromImage({ width: 0, height: 0 }));
    image.src = url;
  });
}

/** Mean brightness of the photo around the shopper, so the garment is lit like the room. */
function photoExposure(frame: HTMLCanvasElement, crop: { x: number; y: number; w: number; h: number }): number {
  const sample = document.createElement('canvas');
  sample.width = 32;
  sample.height = 32;
  const context = sample.getContext('2d');
  if (!context) {
    return 1;
  }
  context.drawImage(frame, crop.x, crop.y, crop.w, crop.h, 0, 0, 32, 32);
  const pixels = context.getImageData(0, 0, 32, 32).data;
  let sum = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    sum += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
  }
  sample.width = 0;
  return Math.min(1.25, Math.max(0.7, sum / (pixels.length / 4) / 150));
}

/** Canonical normal → the photo's camera frame (x right, y up, z toward the camera). */
function viewNormal(view: MirrorViewName, sign: 1 | -1, x: number, y: number, z: number): [number, number, number] {
  return view === 'front' ? [x, y, z] : [-sign * z, y, sign * x];
}

const GARMENT_VERTEX = `
attribute vec3 aColor;
attribute float aOcclusion;
attribute vec2 aPatternUv;
attribute float aRim;
attribute vec3 aFormNormal;
varying vec3 vFormNormal;
varying vec3 vNormalView;
varying vec3 vColor;
varying float vOcclusion;
varying vec2 vPatternUv;
varying float vRim;
void main() {
  vNormalView = normal;
  vColor = aColor;
  vOcclusion = aOcclusion;
  vPatternUv = aPatternUv;
  vRim = aRim;
  vFormNormal = aFormNormal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Cloth, not a cut-out: soft key + fill light matched to the photo's exposure,
// fold occlusion from the drape's own geometry (lib/graphics/cloth-shading.ts),
// a faint jersey knit laid out in GarmentCode pattern space (so it follows
// each panel's grain), and a velvety edge sheen.
const GARMENT_FRAGMENT = `
uniform vec3 uLight;
uniform float uAmbient;
uniform float uExposure;
uniform sampler2D uPhotoLight;
uniform float uPhotoLightMix;
uniform vec2 uResolution;
uniform vec3 uLightTint;
uniform float uHeat;
varying vec3 vNormalView;
varying vec3 vColor;
varying float vOcclusion;
varying vec2 vPatternUv;
varying float vRim;
varying vec3 vFormNormal;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  vec3 n = normalize(vNormalView);
  if (!gl_FrontFacing) n = -n;
  float keyLight = max(dot(n, uLight), 0.0);
  float facing = max(n.z, 0.0);
  // The room's light (fitted on the shopper's skin): ambient share uAmbient,
  // the rest from uLight. Peaks at ~1.0 so a lit fold stays below white.
  float shade = (uAmbient + (0.92 - uAmbient) * keyLight + 0.08 * facing) * mix(vOcclusion, 1.0, uHeat);
  // Cloth turning away from the camera darkens (legs and sleeves read round).
  shade *= mix(0.74, 1.0, pow(facing, 0.6));
  // The photo's own light on the body (photo-shading.ts, stored halved) carries
  // the form light; the drape's normals and fold occlusion add its folds.
  float photoLight = texture2D(uPhotoLight, gl_FragCoord.xy / uResolution).r * 2.0;
  // The folds the solver made: the true surface's light against the
  // garment's smooth form (cloth-shading.ts formNormals), on top of the
  // photo's own light on that form.
  vec3 form = normalize(vFormNormal);
  if (!gl_FrontFacing) form = -form;
  float formLight = uAmbient + (1.0 - uAmbient) * max(dot(form, uLight), 0.0);
  float trueLight = uAmbient + (1.0 - uAmbient) * keyLight;
  float folds = clamp(trueLight / max(formLight, 0.08), 0.5, 1.45);
  float photoShade = photoLight * folds * mix(vOcclusion, 1.0, uHeat) * mix(0.86, 1.0, pow(facing, 0.6));
  shade = mix(shade, photoShade, uPhotoLightMix * (1.0 - uHeat));
  // Open edges (hem, sleeve ends, neckline) show the fabric's thickness turning under.
  shade *= mix(1.0, 0.8, vRim * (1.0 - uHeat));

  // Jersey: vertical wales ~2 mm apart plus a soft slub, in pattern metres.
  float wales = 0.5 + 0.5 * sin(vPatternUv.x * 3000.0);
  float slub = noise(vPatternUv * 260.0);
  float knit = 1.0 + ((wales - 0.5) * 0.022 + (slub - 0.5) * 0.06) * (1.0 - uHeat);

  // White cloth is never paper white in a photo: keep headroom for the light.
  vec3 base = clamp(vColor, vec3(0.035), vec3(0.86));
  float edge = pow(1.0 - max(n.z, 0.0), 2.5);
  // Dark cloth catches a soft highlight on its lit folds, or it reads as a hole.
  // Cotton's soft sheen: brightest where the cloth turns away and catches the light.
  vec3 sheen = (vec3(0.05) * edge * (0.4 + 0.6 * keyLight) + vec3(0.04) * pow(keyLight, 3.0)) * (1.0 - uHeat);
  // The highlight takes the cloth's own hue, so dark blue denim stays blue.
  vec3 tint = base / max(max(base.r, max(base.g, base.b)), 0.001);
  vec3 colour = base * shade * knit * mix(min(uExposure, 1.05), 1.0, uHeat) + sheen * tint * (0.4 + base);
  // Lit by the room's light colour (a warm lamp, a cool window), as the photo is.
  colour *= mix(uLightTint, vec3(1.0), uHeat);
  gl_FragColor = vec4(colour, 1.0);
  #include <colorspace_fragment>
}`;

export const MirrorView: FC<MirrorViewProps> = ({
  parametric,
  photos,
  garment,
  drapePayloadBase64,
  showClearanceHeatmap = false,
  revealed = true,
  onBodyReady,
  onPrintQaFail,
  onFitSummary,
  onPaintUnavailable,
  onGarmentShown,
  className,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [view, setView] = useState<MirrorViewName>('front');
  const [body, setBody] = useState<BodyAssets | null>(null);
  const [albedo, setAlbedo] = useState<PrintQaResult | null>(null);
  /** Clothes / skin / background masks per view; 'failed' when the segmenter could not run. */
  const [personMasks, setPersonMasks] = useState<Partial<Record<MirrorViewName, PersonMasks | 'failed'>>>({});
  /** The shopper's own clothes could not be taken out cleanly: one tip, never a smeared photo. */
  const [clothesTip, setClothesTip] = useState(false);
  const callbacks = useRef({ onBodyReady, onPrintQaFail, onFitSummary, onPaintUnavailable, onGarmentShown });
  callbacks.current = { onBodyReady, onPrintQaFail, onFitSummary, onPaintUnavailable, onGarmentShown };
  const readySent = useRef(false);

  const photoUv = 'photo_uv' in parametric ? parametric.photo_uv ?? null : null;
  const vertexPositions = 'vertex_positions' in parametric ? parametric.vertex_positions ?? null : null;
  const drape = useMemo<SimDrapeMesh | null>(() => {
    if (!drapePayloadBase64) {
      return null;
    }
    try {
      return decodeSimDelta(simDeltaFromBase64(drapePayloadBase64));
    } catch (error) {
      console.error('Garment drape could not be decoded', error);
      callbacks.current.onGarmentShown?.(false);
      return null;
    }
  }, [drapePayloadBase64]);

  // Body geometry: the fitted canonical body, its triangles (depth only) and part labels.
  useEffect(() => {
    if (!vertexPositions || vertexPositions.length !== MHR_VERTEX_COUNT * 3 || !photoUv || !photos?.front) {
      callbacks.current.onPaintUnavailable?.('not_painted');
      return;
    }
    let cancelled = false;
    void Promise.all([loadBodyTriangles(), withRetries(loadBodyParts).catch(() => null)])
      .then(([triangles, parts]) => {
        if (cancelled) {
          return;
        }
        const positions = vertexBufferToMeters(vertexPositions);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setIndex(new THREE.BufferAttribute(triangles, 1));
        geometry.computeVertexNormals();
        const normals = Float32Array.from(geometry.getAttribute('normal').array as ArrayLike<number>);
        geometry.dispose();
        setBody({ positions, triangles, normals, parts, zones: parts ? vertexFillZones(positions, parts) : null });
      })
      .catch(() => {
        if (!cancelled) {
          callbacks.current.onPaintUnavailable?.('not_painted');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [vertexPositions, photoUv, photos?.front]);

  useEffect(() => {
    const url = garment?.albedoUrl;
    if (!url || garment?.printQaPassed === false) {
      setAlbedo(null);
      return;
    }
    let cancelled = false;
    void inspectAlbedo(url).then((qa) => {
      if (cancelled) {
        return;
      }
      if (!qa.passed) {
        callbacks.current.onPrintQaFail?.();
      }
      setAlbedo(qa);
    });
    return () => {
      cancelled = true;
    };
  }, [garment?.albedoUrl, garment?.printQaPassed]);

  // Fit line from the drape's clearance (never changes the size).
  useEffect(() => {
    if (!drape || !body) {
      callbacks.current.onFitSummary?.(null);
      return;
    }
    const positions = compositeSimPositions(drape);
    const heights = new Float32Array(drape.vertexCount);
    for (let i = 0; i < drape.vertexCount; i += 1) {
      heights[i] = positions[i * 3 + 1];
    }
    let floor = Infinity;
    let top = -Infinity;
    for (let i = 1; i < body.positions.length; i += 3) {
      floor = Math.min(floor, body.positions[i]);
      top = Math.max(top, body.positions[i]);
    }
    callbacks.current.onFitSummary?.(fitSummaryLine(summarizeFit({
      positionsY: heights,
      clearanceCm: drape.clearanceCm,
      floorY: floor,
      statureM: top - floor,
      category: garment?.category ?? null,
      easeCm: garment?.easeCm ?? DEFAULT_EASE_CM,
    })));
  }, [drape, body, garment?.category, garment?.easeCm]);

  // The clothes mask of each photo, on this device, while the loader is still up.
  const removesClothes = replacedClothes(garment?.category) !== null;
  useEffect(() => {
    if (!removesClothes || !body?.zones || !photoUv || !photos) {
      return;
    }
    let cancelled = false;
    void (async () => {
      for (const name of ['front', 'side'] as const) {
        const photo = name === 'front' ? photos.front : photos.side;
        const uv = name === 'front' ? photoUv.front_uv : photoUv.side_uv;
        if (!photo || !uv || photo.frame.width === 0) {
          continue;
        }
        const crop = photoCrop(bodyFramePixels(uv, photo.keepBox, photo.frame.width, photo.frame.height), photo.frame);
        if (!crop) {
          continue;
        }
        let result: PersonMasks | 'failed';
        try {
          result = await segmentCrop(photo, crop);
        } catch (error) {
          console.warn('Clothes mask unavailable; showing the photo as taken', error);
          result = 'failed';
        }
        if (cancelled) {
          return;
        }
        setPersonMasks((current) => ({ ...current, [name]: result }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [removesClothes, body, photoUv, photos]);

  // Composite: photo, then the garment drawn into it.
  useEffect(() => {
    const canvas = canvasRef.current;
    const photo = view === 'front' ? photos?.front : photos?.side;
    const uv = view === 'front' ? photoUv?.front_uv : photoUv?.side_uv;
    if (!canvas || !body || !photo || !uv || !photoUv || photo.frame.width === 0) {
      return;
    }
    const frame = photo.frame;
    const pixels = bodyFramePixels(uv, photo.keepBox, frame.width, frame.height);
    const sign = sideCameraSign(body.positions, photoUv.side_weight);
    const crop = photoCrop(pixels, frame);
    if (!crop) {
      callbacks.current.onPaintUnavailable?.('not_painted');
      return;
    }
    canvas.width = crop.w;
    canvas.height = crop.h;
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }
    context.drawImage(frame, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
    if (!readySent.current) {
      readySent.current = true;
      callbacks.current.onBodyReady?.();
    }
    if (!drape) {
      return;
    }

    // A draw that throws (no WebGL on this phone, a lost context) must say so,
    // or the shopper waits on "Dressing you…" forever.
    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(crop.w, crop.h, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setClearColor(0x000000, 0);
      const camera = new THREE.OrthographicCamera(crop.x, crop.x + crop.w, -crop.y, -(crop.y + crop.h), -10, 10);
      const scene = new THREE.Scene();

      // The fitted body, depth only: it hides the garment's far side (the back
      // of the collar behind the neck, the sleeve behind the arm).
      const bodyCount = body.positions.length / 3;
      const occluderPositions = new Float32Array(bodyCount * 3);
      for (let i = 0; i < bodyCount; i += 1) {
        occluderPositions[i * 3] = pixels[i * 2];
        occluderPositions[i * 3 + 1] = -pixels[i * 2 + 1];
        occluderPositions[i * 3 + 2] = viewDepth(view, sign, body.positions[i * 3], body.positions[i * 3 + 2]);
      }
      const occluderGeometry = new THREE.BufferGeometry();
      occluderGeometry.setAttribute('position', new THREE.BufferAttribute(occluderPositions, 3));
      occluderGeometry.setIndex(new THREE.BufferAttribute(body.triangles, 1));
      const occluderMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
      const occluder = new THREE.Mesh(occluderGeometry, occluderMaterial);
      occluder.renderOrder = -1;
      scene.add(occluder);

      // Where the fitted body is in the photo, and the photo's own light on it.
      let zones: BodyZones | null = null;
      if (body.zones) {
        const facingPerVertex = new Float32Array(bodyCount);
        const normalPerVertex = new Float32Array(bodyCount * 3);
        for (let i = 0; i < bodyCount; i += 1) {
          const n = viewNormal(view, sign, body.normals[i * 3], body.normals[i * 3 + 1], body.normals[i * 3 + 2]);
          facingPerVertex[i] = Math.max(0, n[2]);
          normalPerVertex.set(n, i * 3);
        }
        zones = renderBodyZones(
          renderer, camera, occluderPositions, body.triangles, body.zones, facingPerVertex, normalPerVertex, body.parts, crop,
        );
      }
      const masks = personMasks[view];
      const readyMasks = masks && masks !== 'failed' && masks.width === crop.w && masks.height === crop.h ? masks : null;
      const photoPixels = context.getImageData(0, 0, crop.w, crop.h);
      const lighting = zones && readyMasks ? fitSkinLight(photoPixels.data, zones, readyMasks.skin, crop.w) : null;
      const shaderLight = lighting ? lightForShader(lighting) : null;
      // The light across the body, from the shopper's own clothes and skin.
      const onBody = zones ? Uint8Array.from(zones.zone, (value) => (value === FILL_ZONE.outside ? 0 : 1)) : null;
      const shading = zones && readyMasks && onBody && !showClearanceHeatmap
        ? photoShading({
          width: crop.w,
          height: crop.h,
          photo: photoPixels.data,
          clothes: readyMasks.clothes,
          skin: readyMasks.skin,
          onBody,
          radius: Math.max(3, Math.round(crop.h * PHOTO_LIGHT_RADIUS)),
        })
        : null;
      const shadingTexture = shading ? shadingDataTexture(shading, crop.w, crop.h) : null;
      const lightTint = photoLightTint(photoPixels.data);
      const grain = photoGrain(photoPixels.data, readyMasks?.background ?? null, crop.w, crop.h);

      // The draped garment, carried into the photo patch by patch.
      const projector = createPatchProjector(body.positions, pixels, body.parts);
      const draped = compositeSimPositions(drape);
      const count = drape.vertexCount;
      const garmentPositions = new Float32Array(count * 3);
      for (let i = 0; i < count; i += 1) {
        const [u, v] = projector.project(draped[i * 3], draped[i * 3 + 1], draped[i * 3 + 2]);
        garmentPositions[i * 3] = u;
        garmentPositions[i * 3 + 1] = -v;
        // A hair in front of the body it rests on, so the body depth never wins a tie.
        garmentPositions[i * 3 + 2] = viewDepth(view, sign, draped[i * 3], draped[i * 3 + 2]) + 0.003;
      }
      // Seam-smoothed normals and fold occlusion from the drape itself.
      const smoothNormals = seamSmoothNormals(draped, drape.indices);
      const occlusion = foldOcclusion(draped, smoothNormals, drape.indices, { strength: 4, floor: 0.45, spread: 3 });
      const rim = openEdgeRim(draped, drape.indices);
      const form = formNormals(draped, drape.indices, smoothNormals);
      const formView = new Float32Array(count * 3);
      for (let i = 0; i < count; i += 1) {
        formView.set(viewNormal(view, sign, form[i * 3], form[i * 3 + 1], form[i * 3 + 2]), i * 3);
      }
      const normals = new Float32Array(count * 3);
      const colours = new Float32Array(count * 3);
      const fabric = garment?.colorHex
        ? new THREE.Color(garment.colorHex)
        : albedo?.passed && albedo.albedoHex
          ? new THREE.Color(albedo.albedoHex)
          : NEUTRAL_FABRIC.clone();
      // THREE.Color already holds linear values (ColorManagement converts hex and
      // sRGB inputs on the way in); converting again crushed dark cloth to grey.
      const linear = fabric.clone();
      const ease = garment?.easeCm ?? DEFAULT_EASE_CM;
      for (let i = 0; i < count; i += 1) {
        const [nx, ny, nz] = viewNormal(view, sign, smoothNormals[i * 3], smoothNormals[i * 3 + 1], smoothNormals[i * 3 + 2]);
        normals[i * 3] = nx;
        normals[i * 3 + 1] = ny;
        normals[i * 3 + 2] = nz;
        if (showClearanceHeatmap) {
          const heat = mapRadialClearanceToColor(drape.clearanceCm[i], ease);
          const colour = new THREE.Color(heat.r, heat.g, heat.b).convertSRGBToLinear();
          colours[i * 3] = colour.r;
          colours[i * 3 + 1] = colour.g;
          colours[i * 3 + 2] = colour.b;
        } else {
          colours[i * 3] = linear.r;
          colours[i * 3 + 1] = linear.g;
          colours[i * 3 + 2] = linear.b;
        }
      }
      const garmentGeometry = new THREE.BufferGeometry();
      garmentGeometry.setAttribute('aOcclusion', new THREE.BufferAttribute(occlusion, 1));
      garmentGeometry.setAttribute('aRim', new THREE.BufferAttribute(rim, 1));
      garmentGeometry.setAttribute('aFormNormal', new THREE.BufferAttribute(formView, 3));
      garmentGeometry.setAttribute(
        'aPatternUv',
        new THREE.BufferAttribute(drape.uv.length === count * 2 ? drape.uv : new Float32Array(count * 2), 2),
      );
      garmentGeometry.setAttribute('position', new THREE.BufferAttribute(garmentPositions, 3));
      garmentGeometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      garmentGeometry.setAttribute('aColor', new THREE.BufferAttribute(colours, 3));
      garmentGeometry.setIndex(new THREE.BufferAttribute(drape.indices, 1));
      const garmentMaterial = new THREE.ShaderMaterial({
        uniforms: {
          // The photo's own light when it could be read from the shopper's skin.
          uLight: {
            value: shaderLight
              ? new THREE.Vector3(...shaderLight.direction)
              : new THREE.Vector3(view === 'front' ? 0.25 : 0.6, 0.7, view === 'front' ? 0.65 : 0.3).normalize(),
          },
          uAmbient: { value: shaderLight?.ambientShare ?? DEFAULT_AMBIENT_SHARE },
          uPhotoLight: { value: shadingTexture },
          uPhotoLightMix: { value: shadingTexture ? 1 : 0 },
          uResolution: { value: new THREE.Vector2(crop.w, crop.h) },
          uLightTint: { value: new THREE.Vector3(...lightTint) },
          uExposure: { value: photoExposure(frame, crop) },
          uHeat: { value: showClearanceHeatmap ? 1 : 0 },
        },
        vertexShader: GARMENT_VERTEX,
        fragmentShader: GARMENT_FRAGMENT,
        side: THREE.DoubleSide,
      });
      scene.add(new THREE.Mesh(garmentGeometry, garmentMaterial));

      renderer.render(scene, camera);

      // The garment as one layer: collar gaps closed, then used for the clothes
      // removal, the contact shadow and the final draw.
      const layer = document.createElement('canvas');
      layer.width = crop.w;
      layer.height = crop.h;
      const layerContext = layer.getContext('2d', { willReadFrequently: true });
      if (!layerContext) {
        throw new Error('No 2D context for the garment layer.');
      }
      layerContext.drawImage(renderer.domElement, 0, 0);
      const heights = bodyHeights(body.positions);
      const waistRow = rowAtHeight(body, pixels, heights.naturalWaistY, crop.y);
      if (zones && !showClearanceHeatmap && Number.isFinite(waistRow)) {
        const garmentPixels = layerContext.getImageData(0, 0, crop.w, crop.h);
        const collarBand = collarGapBand(zones.zone, zones.head, crop.w, crop.h, crop.h * COLLAR_BAND_REACH);
        const collarRadius = Math.max(2, Math.round(crop.h * COLLAR_GAP_RADIUS));
        const added = closeGarmentGaps({
          width: crop.w,
          height: crop.h,
          rgba: garmentPixels.data,
          allowed: collarBand,
          radius: collarRadius,
          shade: INSIDE_FABRIC_SHADE,
          // The shopper's old collar is not covered with the new garment's colour:
          // a stand-up shirt collar drawn as the crewneck stood up beside the neck
          // like two posts. The clothes removal takes it out (neck skin, wall).
        });
        const trimmed = trimGarmentSpikes({
          width: crop.w,
          height: crop.h,
          rgba: garmentPixels.data,
          allowed: collarBand,
          radius: collarRadius,
        });
        if (added > 0 || trimmed > 0) {
          layerContext.putImageData(garmentPixels, 0, 0);
        }
      }

      // The shopper's own clothes, out where the new garment replaces them.
      const replace = replacedClothes(garment?.category);
      if (replace && zones && readyMasks) {
        const removal = removeReplacedClothes({
          width: crop.w,
          height: crop.h,
          photo: photoPixels.data,
          clothes: readyMasks.clothes,
          background: readyMasks.background,
          skin: readyMasks.skin,
          garment: canvasAlpha(layer, crop.w, crop.h),
          zone: zones.zone,
          facing: zones.facing,
          // Filled skin is lit by the photo's own light: the old sleeve records the arm's.
          skinLight: shading ?? (lighting ? skinLightMap(lighting, zones) : undefined),
          head: zones.head,
          bodyCertain: certainBodyArea(
            zones.zone, zones.head, crop.w, crop.h, crop.h * BODY_CERTAIN_INSET, crop.h * BODY_CERTAIN_HEAD_CLEARANCE,
          ),
          waistRow,
          crotchRow: rowAtHeight(body, pixels, heights.crotchY, crop.y),
          replace,
        });
        if (removal.pixels) {
          photoPixels.data.set(removal.pixels);
          context.putImageData(photoPixels, 0, 0);
        }
        setClothesTip(removal.unsure);
      } else if (replace && masks === 'failed') {
        setClothesTip(true);
      }
      // Contact shadow: a soft, slightly lowered dark copy of the garment under
      // it, so the hem, sleeves and collar sit on the body instead of floating.
      const shade = document.createElement('canvas');
      shade.width = crop.w;
      shade.height = crop.h;
      const shadeContext = shade.getContext('2d');
      if (shadeContext && !showClearanceHeatmap) {
        shadeContext.drawImage(layer, 0, 0);
        shadeContext.globalCompositeOperation = 'source-in';
        shadeContext.fillStyle = 'rgba(20, 16, 12, 0.42)';
        shadeContext.fillRect(0, 0, crop.w, crop.h);
        // The shadow falls on the shopper, never on the wall a metre behind
        // them: a halo there read as a pasted cut-out.
        if (onBody) {
          const bodyMask = shadeContext.createImageData(crop.w, crop.h);
          for (let pixel = 0; pixel < onBody.length; pixel += 1) {
            bodyMask.data[pixel * 4 + 3] = onBody[pixel] ? 255 : 0;
          }
          const maskCanvas = document.createElement('canvas');
          maskCanvas.width = crop.w;
          maskCanvas.height = crop.h;
          maskCanvas.getContext('2d')?.putImageData(bodyMask, 0, 0);
          shadeContext.globalCompositeOperation = 'destination-in';
          shadeContext.drawImage(maskCanvas, 0, 0);
          maskCanvas.width = 0;
        }
        const blurPx = Math.max(2, Math.round(crop.h * 0.006));
        context.save();
        context.filter = `blur(${blurPx}px)`;
        context.drawImage(shade, 0, Math.round(blurPx * 0.8));
        context.restore();
      }
      shade.width = 0;
      // Composited like the photo it sits in: the camera's softness, then its grain.
      context.save();
      context.filter = `blur(${GARMENT_SOFTNESS_PX}px)`;
      context.drawImage(layer, 0, 0);
      context.restore();
      if (grain > 0 && !showClearanceHeatmap) {
        addGarmentGrain(context, layer, crop.w, crop.h, grain);
      }
      layer.width = 0;
      callbacks.current.onGarmentShown?.(true);

      occluderGeometry.dispose();
      occluderMaterial.dispose();
      garmentGeometry.dispose();
      garmentMaterial.dispose();
      shadingTexture?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    } catch (error) {
      console.error('Garment could not be drawn on the photo', error);
      renderer?.dispose();
      renderer?.forceContextLoss();
      callbacks.current.onGarmentShown?.(false);
    }
  }, [albedo, body, drape, garment?.category, garment?.colorHex, garment?.easeCm, personMasks, photoUv, photos, showClearanceHeatmap, view]);

  const hasSide = Boolean(photos?.side && photoUv);

  return (
    <div className={`relative flex items-center justify-center ${className ?? ''}`}>
      <canvas
        ref={canvasRef}
        aria-label={view === 'front' ? 'You, front view, wearing the selected size' : 'You, side view, wearing the selected size'}
        className={`h-full w-full object-contain transition-opacity duration-700 ${revealed ? 'opacity-100' : 'opacity-0'}`}
      />
      {clothesTip && drape && revealed ? (
        <p className="pointer-events-none absolute inset-x-4 bottom-16 mx-auto w-fit max-w-[90%] rounded-full bg-white/85 px-3 py-1 text-center text-[11px] font-medium text-ash-ink shadow-card">
          Tip: wear a fitted T-shirt for the cleanest look
        </p>
      ) : null}
      {hasSide ? (
        <div
          role="radiogroup"
          aria-label="View"
          className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1 rounded-full bg-white/85 p-1 shadow-card"
        >
          {(['front', 'side'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={view === option}
              onClick={() => setView(option)}
              className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                view === option ? 'bg-ash-ink text-white' : 'text-ash-muted hover:text-ash-ink'
              }`}
            >
              {option === 'front' ? 'Front' : 'Side'}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};
