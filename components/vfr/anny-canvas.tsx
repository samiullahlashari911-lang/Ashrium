'use client';

import { useEffect, useRef, useState, type FC } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { RadialHeatmapLegend } from '@/components/vfr/radial-heatmap-legend';
import type { OnDevicePhotos } from '@/lib/widget/webp-encode';
import {
  applyFacelessMannequin,
  applyMannequinMaterial,
  createGarmentAlbedoMaterial,
  garmentCodeUvsFromPositions,
  paintMannequinUndergarment,
} from '@/lib/graphics/anny-garment';
import {
  applyAnnyParametricDeform,
  applyMhrVertexPositions,
  findAnnyHullMesh,
  findMhrHullMesh,
} from '@/lib/graphics/anny-hull';
import { disposeMaterial, disposeObject3D, disposeRendererSession } from '@/lib/graphics/dispose-session';
import { loadBodyParts, skinFillMask } from '@/lib/graphics/body-parts';
import {
  buildPhotoSkinAttributes,
  createPhotoSkinMaterial,
  photoFrameMeta,
  releaseFrameMeta,
  sampleSkinColor,
  setPhotoSkinFill,
} from '@/lib/graphics/photo-skin';
import { subscribeViewportActivity } from '@/lib/graphics/viewport-activity';
import {
  compositeSimPositions,
  decodeSimDelta,
  simDeltaFromBase64,
} from '@/lib/graphics/meshopt-delta';
import {
  evaluatePrintQaFromImage,
  failedPrintQa,
  type PrintQaResult,
} from '@/lib/graphics/print-qa';
import { fitSummaryLine, summarizeFit } from '@/lib/fit/fit-summary';
import { DEFAULT_EASE_CM } from '@/lib/graphics/radial-heatmap';
import { createFitShaderMaterial } from '@/lib/graphics/strain-shader';
import type { GarmentCategory } from '@/types/garment';
import {
  ANNY_HULL_GLB_PUBLIC_PATH,
  MHR_HULL_GLB_PUBLIC_PATH,
  isMhrParametricVector,
  type FitParametricVector,
} from '@/types/hmr';

/**
 * The garment layer renders only a real drape (cache hit or Newton run).
 * Until one lands the avatar wears the neutral undergarment — never an
 * invented approximation of the garment.
 */
export interface AnnyCanvasGarment {
  easeCm: number;
  /** Which of the shopper's own clothes the draped garment replaces. */
  category?: GarmentCategory | null;
  albedoUrl?: string | null;
  printQaPassed?: boolean;
}

export type PaintUnavailableReason = 'not_painted' | 'face_not_found';

export interface AnnyCanvasProps {
  parametric: FitParametricVector;
  heightCm: number;
  garment?: AnnyCanvasGarment | null;
  /** Base64 meshopt delta from /api/v1/fit/resolve. When set, V_final = V_0 + ΔX. */
  drapePayloadBase64?: string | null;
  /** Clearance heatmap on the draped garment (toggle lives in the parent panel). */
  showClearanceHeatmap?: boolean;
  /** A slow sway on first reveal (within what the photos saw); any touch stops it. */
  turntable?: boolean;
  /** Client pixel QA can still fail after ingest; parent ORs this into Approximate. */
  onPrintQaFail?: () => void;
  /** One plain line about how the draped garment sits, or null without a drape. */
  onFitSummary?: (line: string | null) => void;
  /** Fires once the avatar body is in the scene (still hidden until `revealed`). */
  onBodyReady?: () => void;
  /** The body could not be built (asset or vertex buffer failed). */
  onBodyError?: () => void;
  /** Hold the body invisible until true, then fade it in; the garment dresses after. */
  revealed?: boolean;
  /**
   * The shopper's own front/side camera frames. With the GPU's `photo_uv`
   * they paint the whole avatar (face, hair, skin, clothes) on this device.
   */
  photos?: OnDevicePhotos | null;
  /**
   * `photos` were given but cannot paint the avatar (no GPU photo_uv, frame
   * gone, or the face could not be found in the frame). The storefront asks
   * for a retake instead of ever showing the fallback mannequin (spec Q9).
   */
  onPaintUnavailable?: (reason: PaintUnavailableReason) => void;
  className?: string;
}

interface LoadedAlbedo {
  qa: PrintQaResult;
  texture: THREE.Texture | null;
}

interface Tween {
  startedAt: number;
  durationMs: number;
  update: (eased: number) => void;
  done?: () => void;
}

/** Long-lived scene objects shared between the body and garment layers. */
interface SceneHandles {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  hullOffset: THREE.Vector3;
  bodyTopY: number;
  bodyBottomY: number;
  tweens: Tween[];
  garmentMesh: THREE.Mesh | null;
  albedoMaterial: THREE.Material | null;
  heatMaterial: THREE.ShaderMaterial | null;
  /** Body painted from the shopper's photos, and their skin colour (on-device). */
  photoBody: THREE.Mesh | null;
  skinColor: [number, number, number] | null;
  /** The body has finished fading in; until then a garment fades in with it. */
  bodyRevealed: boolean;
  /** Opacity of the body's reveal fade, shared with a garment added before it ends. */
  revealOpacity: number;
}

let bodyPartsRequest: Promise<Uint8Array> | null = null;
let bodyPartsLoaded: Uint8Array | null = null;

function bodyParts(): Promise<Uint8Array> {
  bodyPartsRequest ??= loadBodyParts()
    .then((labels) => {
      bodyPartsLoaded = labels;
      return labels;
    })
    .catch((error: unknown) => {
      bodyPartsRequest = null;
      throw error;
    });
  return bodyPartsRequest;
}

const REVEAL_MS = 1400;
const DRESS_MS = 1500;
/** Orbit stops 65 deg each side of front: past that one side only has the front photo at a grazing angle, and the back was never photographed. */
const ORBIT_LIMIT_RAD = (65 * Math.PI) / 180;
/** First-reveal sway: +-30 deg and back to front. */
const SWAY_RAD = (30 * Math.PI) / 180;
const SWAY_MS = 6000;

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
}

function inspectAlbedoImage(url: string): Promise<LoadedAlbedo> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      let pixels: Uint8ClampedArray | undefined;
      try {
        const canvas = document.createElement('canvas');
        const width = Math.max(1, Math.min(96, image.naturalWidth));
        const height = Math.max(1, Math.min(96, image.naturalHeight));
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (context) {
          context.drawImage(image, 0, 0, width, height);
          pixels = context.getImageData(0, 0, width, height).data;
        }
      } catch {
        pixels = undefined;
      }

      const qa = evaluatePrintQaFromImage({
        width: image.naturalWidth,
        height: image.naturalHeight,
        pixels,
      });
      if (!qa.passed) {
        resolve({ qa, texture: null });
        return;
      }

      const texture = new THREE.Texture(image);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.needsUpdate = true;
      resolve({
        qa,
        texture: qa.mode === 'texture' ? texture : null,
      });
    };
    image.onerror = () => {
      resolve({ qa: failedPrintQa('load_failed'), texture: null });
    };
    image.src = url;
  });
}

function removeGarment(handles: SceneHandles): void {
  if (handles.garmentMesh) {
    handles.scene.remove(handles.garmentMesh);
    handles.garmentMesh.geometry.dispose();
  }
  [handles.albedoMaterial, handles.heatMaterial].forEach((material) => {
    if (!material) {
      return;
    }
    Object.values(material).forEach((value) => {
      if (value instanceof THREE.Texture) {
        value.dispose();
      }
    });
    material.dispose();
  });
  handles.garmentMesh = null;
  handles.albedoMaterial = null;
  handles.heatMaterial = null;
  if (handles.photoBody) {
    setPhotoSkinFill(handles.photoBody, null, null);
  }
}

export const AnnyCanvas: FC<AnnyCanvasProps> = ({
  parametric,
  heightCm,
  garment = null,
  drapePayloadBase64 = null,
  showClearanceHeatmap = false,
  turntable = true,
  onPrintQaFail,
  onFitSummary,
  onPaintUnavailable,
  onBodyReady,
  onBodyError,
  revealed = true,
  photos = null,
  className = 'h-[560px] w-full overflow-hidden rounded-xl',
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const handlesRef = useRef<SceneHandles | null>(null);
  const printQaFailRef = useRef(onPrintQaFail);
  const fitSummaryRef = useRef(onFitSummary);
  fitSummaryRef.current = onFitSummary;
  const paintUnavailableRef = useRef(onPaintUnavailable);
  paintUnavailableRef.current = onPaintUnavailable;
  const bodyReadyRef = useRef(onBodyReady);
  const bodyErrorRef = useRef(onBodyError);
  const revealedRef = useRef(revealed);
  const startRevealRef = useRef<(() => void) | null>(null);
  const heatmapRef = useRef(showClearanceHeatmap);
  const turntableRef = useRef(turntable);
  printQaFailRef.current = onPrintQaFail;
  bodyReadyRef.current = onBodyReady;
  bodyErrorRef.current = onBodyError;
  revealedRef.current = revealed;
  heatmapRef.current = showClearanceHeatmap;
  turntableRef.current = turntable;
  const [bodyVersion, setBodyVersion] = useState(0);
  const [garmentDraped, setGarmentDraped] = useState(false);

  const garmentEaseCm = garment?.easeCm;
  const garmentCategory = garment?.category ?? null;
  const albedoUrl = garment?.albedoUrl ?? null;
  const ingestPrintQaPassed = garment?.printQaPassed;

  // Layer 1 — renderer, studio, and the avatar body. Rebuilds only when the body changes.
  useEffect(() => {
    const mountElement = mountRef.current;
    if (!mountElement) {
      return;
    }

    mountElement.innerHTML = '';
    startRevealRef.current = null;
    const width = mountElement.clientWidth || 800;
    const height = mountElement.clientHeight || 560;
    let disposed = false;
    let animationFrameId: number | null = null;

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 100);
    camera.position.set(0, 0.95, 3.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;
    mountElement.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.enablePan = false;
    controls.minDistance = 1.4;
    controls.maxDistance = 5.5;
    controls.minPolarAngle = Math.PI * 0.18;
    controls.maxPolarAngle = Math.PI * 0.62;
    controls.target.set(0, 0.85, 0);
    // Two photos see the front and one side: never turn far enough to show
    // the back, which no photo saw.
    controls.minAzimuthAngle = -ORBIT_LIMIT_RAD;
    controls.maxAzimuthAngle = ORBIT_LIMIT_RAD;
    controls.update();

    let swaying = false;
    const stopTurntable = (): void => {
      swaying = false;
    };
    controls.addEventListener('start', stopTurntable);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xe9e2d8, 1.15));

    const keyLight = new THREE.DirectionalLight(0xfff6ee, 1.6);
    keyLight.position.set(2.4, 4.4, 3.2);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 12;
    keyLight.shadow.radius = 6;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xe4e8ff, 0.9);
    rimLight.position.set(-2.6, 2.6, -3.0);
    scene.add(rimLight);

    const floorGeometry = new THREE.CircleGeometry(1.6, 64);
    const floorMaterial = new THREE.ShadowMaterial({ opacity: 0.14 });
    const floorMesh = new THREE.Mesh(floorGeometry, floorMaterial);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    const handles: SceneHandles = {
      scene,
      renderer,
      hullOffset: new THREE.Vector3(),
      bodyTopY: 1.7,
      bodyBottomY: 0,
      tweens: [],
      garmentMesh: null,
      albedoMaterial: null,
      heatMaterial: null,
      photoBody: null,
      skinColor: null,
      bodyRevealed: false,
      revealOpacity: 0,
    };
    handlesRef.current = handles;

    const loader = new GLTFLoader();
    const hullPath = isMhrParametricVector(parametric)
      ? MHR_HULL_GLB_PUBLIC_PATH
      : ANNY_HULL_GLB_PUBLIC_PATH;

    void (async () => {
      let gltf: Awaited<ReturnType<GLTFLoader['loadAsync']>>;
      try {
        gltf = await loader.loadAsync(hullPath);
      } catch {
        if (!disposed) {
          bodyErrorRef.current?.();
        }
        return;
      }

      if (disposed) {
        disposeObject3D(gltf.scene);
        return;
      }

      const hull = gltf.scene;
      applyMannequinMaterial(hull);

      try {
        if (isMhrParametricVector(parametric)) {
          applyMhrVertexPositions(hull, parametric);
        } else {
          applyAnnyParametricDeform(hull, parametric, heightCm);
        }
      } catch {
        disposeObject3D(hull);
        bodyErrorRef.current?.();
        return;
      }

      const bodyMesh = isMhrParametricVector(parametric)
        ? findMhrHullMesh(hull)
        : findAnnyHullMesh(hull);
      // The shopper's own look, painted from their photos on this device.
      const photoUv = isMhrParametricVector(parametric) ? parametric.photo_uv : undefined;
      const frontPhoto = photos?.front ?? null;
      const painted = Boolean(bodyMesh && photoUv && frontPhoto && frontPhoto.frame.width > 0);
      if (bodyMesh && photoUv && frontPhoto && painted) {
        const sidePhoto = photos?.side && photos.side.frame.width > 0 ? photos.side : null;
        bodyMesh.geometry.computeVertexNormals();
        // Each frame's pixels are read once here and wiped right after.
        const frontMeta = photoFrameMeta(frontPhoto);
        const sideMeta = sidePhoto ? photoFrameMeta(sidePhoto) : null;
        const attributes = buildPhotoSkinAttributes(
          bodyMesh.geometry.getAttribute('position').array as Float32Array,
          photoUv,
          frontMeta,
          sideMeta,
          bodyMesh.geometry.getIndex()?.array ?? [],
        );
        handles.skinColor = sampleSkinColor(frontMeta);
        releaseFrameMeta(frontMeta);
        releaseFrameMeta(sideMeta);
        const previous = bodyMesh.material;
        bodyMesh.material = createPhotoSkinMaterial(bodyMesh.geometry, attributes, frontPhoto, sidePhoto);
        (Array.isArray(previous) ? previous : [previous]).forEach(disposeMaterial);
        handles.photoBody = bodyMesh;
        if (!attributes.front) {
          paintUnavailableRef.current?.('face_not_found');
        }
        void bodyParts().catch(() => undefined);
      }
      if (bodyMesh && !painted) {
        // Sandbox / gallery debug only: the storefront retakes instead (Q9).
        applyFacelessMannequin(bodyMesh);
        paintMannequinUndergarment(bodyMesh);
        if (photos) {
          paintUnavailableRef.current?.('not_painted');
        }
      }

      const bounds = new THREE.Box3().setFromObject(hull);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      hull.position.sub(center);
      hull.position.y += size.y / 2;
      handles.hullOffset.copy(hull.position);
      handles.bodyTopY = size.y;
      handles.bodyBottomY = 0;

      const target = new THREE.Vector3(0, size.y * 0.5, 0);
      const restDistance = Math.max(2.6, size.y * 1.95);
      const restPosition = new THREE.Vector3(0, size.y * 0.56, restDistance);
      const startPosition = new THREE.Vector3(0.35, size.y * 0.62, restDistance * 1.45);
      controls.target.copy(target);
      camera.position.copy(startPosition);
      controls.update();

      scene.add(hull);

      hull.updateMatrixWorld(true);
      const fadeMaterials: THREE.Material[] = [];
      hull.traverse((node) => {
        if (node instanceof THREE.Mesh && !Array.isArray(node.material)) {
          fadeMaterials.push(node.material);
        }
      });
      // Reveal: fade the body in while the camera glides to its resting orbit.
      // It waits, invisible, until the parent says the loader is done.
      fadeMaterials.forEach((material) => {
        material.transparent = true;
        material.opacity = 0;
      });
      const startReveal = (): void => {
        handles.tweens.push({
          startedAt: performance.now(),
          durationMs: REVEAL_MS,
          update: (eased) => {
            handles.revealOpacity = Math.min(1, eased * 1.6);
            [...fadeMaterials, handles.albedoMaterial].forEach((material) => {
              if (material) {
                material.opacity = handles.revealOpacity;
              }
            });
            if (handles.heatMaterial) {
              handles.heatMaterial.uniforms.uOpacity.value = 0.9 * handles.revealOpacity;
            }
            camera.position.lerpVectors(startPosition, restPosition, eased);
          },
          done: () => {
            handles.revealOpacity = 1;
            handles.bodyRevealed = true;
            if (handles.heatMaterial) {
              handles.heatMaterial.uniforms.uOpacity.value = 0.9;
            }
            [...fadeMaterials, handles.albedoMaterial].forEach((material) => {
              if (material) {
                material.opacity = 1;
                material.transparent = false;
                material.needsUpdate = true;
              }
            });
            if (turntableRef.current) {
              // A slow sway to each side and back, within what the photos saw.
              const offset = camera.position.clone().sub(controls.target);
              const radius = Math.hypot(offset.x, offset.z);
              const base = Math.atan2(offset.x, offset.z);
              swaying = true;
              handles.tweens.push({
                startedAt: performance.now(),
                durationMs: SWAY_MS,
                update: (eased) => {
                  if (!swaying) {
                    return;
                  }
                  const angle = base + SWAY_RAD * Math.sin(eased * Math.PI * 2);
                  camera.position.x = controls.target.x + radius * Math.sin(angle);
                  camera.position.z = controls.target.z + radius * Math.cos(angle);
                },
                done: () => {
                  swaying = false;
                },
              });
            }
          },
        });
      };
      if (revealedRef.current) {
        startReveal();
      } else {
        startRevealRef.current = startReveal;
      }

      bodyReadyRef.current?.();
      setBodyVersion((version) => version + 1);
    })();

    let renderActive = true;

    const stopLoop = (): void => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    };

    const animate = (): void => {
      if (!renderActive) {
        animationFrameId = null;
        return;
      }

      animationFrameId = requestAnimationFrame(animate);
      const now = performance.now();
      handles.tweens = handles.tweens.filter((tween) => {
        const t = Math.min(1, (now - tween.startedAt) / tween.durationMs);
        tween.update(easeInOutCubic(t) * 0.35 + easeOutCubic(t) * 0.65);
        if (t >= 1) {
          tween.done?.();
          return false;
        }
        return true;
      });

      controls.update();
      renderer.render(scene, camera);
    };

    const stopActivity = subscribeViewportActivity(mountElement, (active) => {
      renderActive = active;
      if (active) {
        if (animationFrameId === null) {
          animate();
        }
        return;
      }

      stopLoop();
    });

    const handleResize = (): void => {
      const nextWidth = mountElement.clientWidth;
      const nextHeight = mountElement.clientHeight;
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(nextWidth, nextHeight);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      disposed = true;
      window.removeEventListener('resize', handleResize);
      controls.removeEventListener('start', stopTurntable);
      stopActivity();
      stopLoop();
      removeGarment(handles);
      handlesRef.current = null;
      disposeRendererSession({
        animationFrameId,
        controls,
        scene,
        renderer,
        mountElement,
      });
    };
  }, [heightCm, parametric, photos]);

  useEffect(() => {
    if (revealed && startRevealRef.current) {
      startRevealRef.current();
      startRevealRef.current = null;
    }
  }, [bodyVersion, revealed]);

  // Layer 2 — the garment. Rebuilds on drape / size / albedo changes without
  // touching the body. The first drape fades in with the body, so the shopper
  // first sees themselves dressed; a size switch swaps in place; only a drape
  // landing after the body is already showing pours on.
  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles || bodyVersion === 0) {
      return;
    }

    let cancelled = false;
    setGarmentDraped(false);
    fitSummaryRef.current?.(null);

    void (async () => {
      const visualizationOff = ingestPrintQaPassed === false;
      if (visualizationOff || !drapePayloadBase64) {
        return;
      }

      let loadedAlbedo: LoadedAlbedo | null = null;
      if (albedoUrl) {
        loadedAlbedo = await inspectAlbedoImage(albedoUrl);
        if (cancelled) {
          loadedAlbedo.texture?.dispose();
          return;
        }
        if (!loadedAlbedo.qa.passed) {
          loadedAlbedo.texture?.dispose();
          printQaFailRef.current?.();
          return;
        }
      }

      const albedoMaterial = createGarmentAlbedoMaterial({
        map: loadedAlbedo?.texture ?? null,
        albedoHex: loadedAlbedo?.qa.albedoHex,
      });

      let geometry: THREE.BufferGeometry | null = null;
      try {
        const mesh = decodeSimDelta(simDeltaFromBase64(drapePayloadBase64));
        const positions = compositeSimPositions(mesh);
        geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aClearanceCm', new THREE.BufferAttribute(mesh.clearanceCm, 1));
        geometry.setAttribute(
          'uv',
          new THREE.BufferAttribute(garmentCodeUvsFromPositions(mesh.restPositions), 2),
        );
        geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
        geometry.computeVertexNormals();
      } catch {
        geometry?.dispose();
        geometry = null;
      }

      if (!geometry || cancelled || handlesRef.current !== handles) {
        geometry?.dispose();
        albedoMaterial.dispose();
        loadedAlbedo?.texture?.dispose();
        return;
      }

      const swapping = handles.garmentMesh !== null;
      removeGarment(handles);
      const heatMaterial = createFitShaderMaterial(garmentEaseCm ?? DEFAULT_EASE_CM);
      const garmentMesh = new THREE.Mesh(
        geometry,
        heatmapRef.current ? heatMaterial : albedoMaterial,
      );
      garmentMesh.position.copy(handles.hullOffset);
      garmentMesh.castShadow = true;
      garmentMesh.receiveShadow = true;
      handles.scene.add(garmentMesh);
      handles.garmentMesh = garmentMesh;
      handles.albedoMaterial = albedoMaterial;
      handles.heatMaterial = heatMaterial;
      setGarmentDraped(true);
      const positionAttribute = geometry.getAttribute('position');
      const clearanceAttribute = geometry.getAttribute('aClearanceCm');
      const heightsY = new Float32Array(positionAttribute.count);
      for (let i = 0; i < positionAttribute.count; i += 1) {
        heightsY[i] = positionAttribute.getY(i) + handles.hullOffset.y;
      }
      fitSummaryRef.current?.(fitSummaryLine(summarizeFit({
        positionsY: heightsY,
        clearanceCm: clearanceAttribute.array as Float32Array,
        floorY: handles.bodyBottomY,
        statureM: handles.bodyTopY - handles.bodyBottomY,
        category: garmentCategory,
        easeCm: garmentEaseCm ?? DEFAULT_EASE_CM,
      })));

      // Wherever the new garment replaces the shopper's own clothes but does
      // not cover them, show their skin (on-device).
      const fillSkin = (): void => {
        const photoBody = handles.photoBody;
        const skinColor = handles.skinColor;
        if (!photoBody || !skinColor || !garmentCategory) {
          return;
        }
        if (bodyPartsLoaded) {
          setPhotoSkinFill(photoBody, skinFillMask(bodyPartsLoaded, garmentCategory), skinColor);
          return;
        }
        void bodyParts()
          .then((labels) => {
            if (!cancelled && handles.garmentMesh === garmentMesh) {
              setPhotoSkinFill(photoBody, skinFillMask(labels, garmentCategory), skinColor);
            }
          })
          .catch(() => {
            // Without labels the shopper's own clothes stay visible; never block dressing.
          });
      };

      if (!handles.bodyRevealed) {
        albedoMaterial.transparent = true;
        albedoMaterial.opacity = handles.revealOpacity;
        heatMaterial.uniforms.uOpacity.value = 0.9 * handles.revealOpacity;
        fillSkin();
        return;
      }
      if (swapping) {
        fillSkin();
        return;
      }

      // Dressing: a clipping plane sweeps from the collar down so the garment
      // "pours" onto the body. The fit shader has no clipping chunk, so the
      // sweep runs on the fabric material only.
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -handles.bodyTopY);
      albedoMaterial.clippingPlanes = [plane];
      handles.tweens.push({
        startedAt: performance.now(),
        durationMs: DRESS_MS,
        update: (eased) => {
          const y = handles.bodyTopY - eased * (handles.bodyTopY - handles.bodyBottomY + 0.05);
          plane.constant = -y;
        },
        done: () => {
          albedoMaterial.clippingPlanes = [];
          albedoMaterial.needsUpdate = true;
          fillSkin();
        },
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    albedoUrl,
    bodyVersion,
    drapePayloadBase64,
    garmentCategory,
    garmentEaseCm,
    ingestPrintQaPassed,
  ]);

  // Layer 3 — heatmap toggle swaps the material; no rebuild.
  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles?.garmentMesh || !handles.heatMaterial || !handles.albedoMaterial) {
      return;
    }
    handles.garmentMesh.material = showClearanceHeatmap ? handles.heatMaterial : handles.albedoMaterial;
  }, [garmentDraped, showClearanceHeatmap]);

  return (
    <div className={`relative ${className}`}>
      <div ref={mountRef} className="h-full w-full" />
      {showClearanceHeatmap && garmentDraped ? <RadialHeatmapLegend /> : null}
    </div>
  );
};
