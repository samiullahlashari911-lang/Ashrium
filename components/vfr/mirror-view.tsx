'use client';

import { useEffect, useMemo, useRef, useState, type FC } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import type { AnnyCanvasGarment, PaintUnavailableReason } from '@/components/vfr/anny-canvas';
import { fitSummaryLine, summarizeFit } from '@/lib/fit/fit-summary';
import { findMhrHullMesh, vertexBufferToMeters } from '@/lib/graphics/anny-hull';
import { loadBodyParts } from '@/lib/graphics/body-parts';
import { foldOcclusion, seamSmoothNormals } from '@/lib/graphics/cloth-shading';
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
import type { OnDevicePhotos } from '@/lib/widget/webp-encode';
import type { SimDrapeMesh } from '@/types/graphics';
import { MHR_HULL_GLB_PUBLIC_PATH, MHR_VERTEX_COUNT, type FitParametricVector } from '@/types/hmr';

/**
 * The shopper's result: their own photo (front or side), the garment they
 * chose drawn in where Newton draped it on their fitted body. Nothing in the
 * photo is erased or invented (owner Q16, 2026-10-10): where the new garment
 * covers less than what they wore, their own clothes show. The photos never
 * leave this device; everything here runs in the browser.
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

/** Fallback fabric when the product image gives no colour (print QA off). */
const NEUTRAL_FABRIC = new THREE.Color().setRGB(0.32, 0.33, 0.36, THREE.SRGBColorSpace);
/** Space around the shopper in the cropped photo (fraction of their height). */
const CROP_MARGIN = 0.08;

interface BodyAssets {
  positions: Float32Array;
  triangles: Uint32Array;
  normals: Float32Array;
  parts: Uint8Array | null;
}

function loadBodyTriangles(): Promise<Uint32Array> {
  return new GLTFLoader().loadAsync(MHR_HULL_GLB_PUBLIC_PATH).then((gltf) => {
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
varying vec3 vNormalView;
varying vec3 vColor;
varying float vOcclusion;
varying vec2 vPatternUv;
void main() {
  vNormalView = normal;
  vColor = aColor;
  vOcclusion = aOcclusion;
  vPatternUv = aPatternUv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Cloth, not a cut-out: soft key + fill light matched to the photo's exposure,
// fold occlusion from the drape's own geometry (lib/graphics/cloth-shading.ts),
// a faint jersey knit laid out in GarmentCode pattern space (so it follows
// each panel's grain), and a velvety edge sheen.
const GARMENT_FRAGMENT = `
uniform vec3 uLight;
uniform float uExposure;
uniform float uHeat;
varying vec3 vNormalView;
varying vec3 vColor;
varying float vOcclusion;
varying vec2 vPatternUv;

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
  float keyLight = clamp((dot(n, uLight) + 0.3) / 1.3, 0.0, 1.0);
  float facing = max(n.z, 0.0);
  // Peaks at ~1.0: a lit fold face stays below white, so shading always shows.
  float shade = (0.42 + 0.46 * keyLight + 0.12 * facing) * mix(vOcclusion, 1.0, uHeat);
  // Cloth turning away from the camera darkens (legs and sleeves read round).
  shade *= mix(0.74, 1.0, pow(facing, 0.6));

  // Jersey: vertical wales ~2 mm apart plus a soft slub, in pattern metres.
  float wales = 0.5 + 0.5 * sin(vPatternUv.x * 3000.0);
  float slub = noise(vPatternUv * 260.0);
  float knit = 1.0 + ((wales - 0.5) * 0.05 + (slub - 0.5) * 0.08) * (1.0 - uHeat);

  // White cloth is never paper white in a photo: keep headroom for the light.
  vec3 base = clamp(vColor, vec3(0.035), vec3(0.86));
  float edge = pow(1.0 - max(n.z, 0.0), 2.5);
  // Dark cloth catches a soft highlight on its lit folds, or it reads as a hole.
  vec3 sheen = (vec3(0.035) * edge + vec3(0.05) * pow(keyLight, 3.0)) * (1.0 - uHeat);
  // The highlight takes the cloth's own hue, so dark blue denim stays blue.
  vec3 tint = base / max(max(base.r, max(base.g, base.b)), 0.001);
  vec3 colour = base * shade * knit * mix(min(uExposure, 1.05), 1.0, uHeat) + sheen * tint * (0.4 + base);
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
    void Promise.all([loadBodyTriangles(), loadBodyParts().catch(() => null)])
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
        setBody({ positions, triangles, normals, parts });
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

    // Crop to the shopper (their projected body) with a margin, inside the frame.
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
    if (crop.w <= 0 || crop.h <= 0) {
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

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
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
        uLight: { value: new THREE.Vector3(view === 'front' ? 0.25 : 0.6, 0.7, view === 'front' ? 0.65 : 0.3).normalize() },
        uExposure: { value: photoExposure(frame, crop) },
        uHeat: { value: showClearanceHeatmap ? 1 : 0 },
      },
      vertexShader: GARMENT_VERTEX,
      fragmentShader: GARMENT_FRAGMENT,
      side: THREE.DoubleSide,
    });
    scene.add(new THREE.Mesh(garmentGeometry, garmentMaterial));

    renderer.render(scene, camera);
    // Contact shadow: a soft, slightly lowered dark copy of the garment under
    // it, so the hem, sleeves and collar sit on the body instead of floating.
    const shade = document.createElement('canvas');
    shade.width = crop.w;
    shade.height = crop.h;
    const shadeContext = shade.getContext('2d');
    if (shadeContext && !showClearanceHeatmap) {
      shadeContext.drawImage(renderer.domElement, 0, 0);
      shadeContext.globalCompositeOperation = 'source-in';
      shadeContext.fillStyle = 'rgba(20, 16, 12, 0.42)';
      shadeContext.fillRect(0, 0, crop.w, crop.h);
      const blurPx = Math.max(2, Math.round(crop.h * 0.006));
      context.save();
      context.filter = `blur(${blurPx}px)`;
      context.drawImage(shade, 0, Math.round(blurPx * 0.8));
      context.restore();
    }
    shade.width = 0;
    context.drawImage(renderer.domElement, 0, 0);
    callbacks.current.onGarmentShown?.(true);

    occluderGeometry.dispose();
    occluderMaterial.dispose();
    garmentGeometry.dispose();
    garmentMaterial.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }, [albedo, body, drape, garment?.colorHex, garment?.easeCm, photoUv, photos, showClearanceHeatmap, view]);

  const hasSide = Boolean(photos?.side && photoUv);

  return (
    <div className={`relative flex items-center justify-center ${className ?? ''}`}>
      <canvas
        ref={canvasRef}
        aria-label={view === 'front' ? 'You, front view, wearing the selected size' : 'You, side view, wearing the selected size'}
        className={`h-full w-full object-contain transition-opacity duration-700 ${revealed ? 'opacity-100' : 'opacity-0'}`}
      />
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
