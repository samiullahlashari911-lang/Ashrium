'use client';

import { useEffect, useRef, useState, type FC } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { RadialHeatmapLegend } from '@/components/vfr/radial-heatmap-legend';
import type { OnDeviceFace } from '@/lib/widget/webp-encode';
import {
  applyFacelessMannequin,
  applyMannequinMaterial,
  buildFaceDecalGeometry,
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
import { disposeObject3D, disposeRendererSession } from '@/lib/graphics/dispose-session';
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
import { DEFAULT_EASE_CM } from '@/lib/graphics/radial-heatmap';
import { createFitShaderMaterial } from '@/lib/graphics/strain-shader';
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
  albedoUrl?: string | null;
  printQaPassed?: boolean;
}

export interface AnnyCanvasProps {
  parametric: FitParametricVector;
  heightCm: number;
  garment?: AnnyCanvasGarment | null;
  /** Base64 meshopt delta from /api/v1/fit/resolve. When set, V_final = V_0 + ΔX. */
  drapePayloadBase64?: string | null;
  /** Clearance heatmap on the draped garment (toggle lives in the parent panel). */
  showClearanceHeatmap?: boolean;
  /** One slow turn on first reveal; any touch stops it. */
  turntable?: boolean;
  /** Client pixel QA can still fail after ingest; parent ORs this into Approximate. */
  onPrintQaFail?: () => void;
  /** Fires once the avatar body is in the scene (still hidden until `revealed`). */
  onBodyReady?: () => void;
  /** The body could not be built (asset or vertex buffer failed). */
  onBodyError?: () => void;
  /** Hold the body invisible until true, then fade it in; the garment dresses after. */
  revealed?: boolean;
  /** On-device face (merchant opt-in). Drawn here only; never uploaded. */
  faceImage?: OnDeviceFace | null;
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
}

const REVEAL_MS = 1400;
const DRESS_MS = 1500;
const TURNTABLE_SECONDS_PER_TURN = 9;

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
}

export const AnnyCanvas: FC<AnnyCanvasProps> = ({
  parametric,
  heightCm,
  garment = null,
  drapePayloadBase64 = null,
  showClearanceHeatmap = false,
  turntable = true,
  onPrintQaFail,
  onBodyReady,
  onBodyError,
  revealed = true,
  faceImage = null,
  className = 'h-[560px] w-full overflow-hidden rounded-xl',
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const handlesRef = useRef<SceneHandles | null>(null);
  const printQaFailRef = useRef(onPrintQaFail);
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
  const [bodyShown, setBodyShown] = useState(false);
  const [garmentDraped, setGarmentDraped] = useState(false);

  const garmentEaseCm = garment?.easeCm;
  const albedoUrl = garment?.albedoUrl ?? null;
  const ingestPrintQaPassed = garment?.printQaPassed;

  // Layer 1 — renderer, studio, and the avatar body. Rebuilds only when the body changes.
  useEffect(() => {
    const mountElement = mountRef.current;
    if (!mountElement) {
      return;
    }

    mountElement.innerHTML = '';
    setBodyShown(false);
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
    controls.autoRotateSpeed = 60 / TURNTABLE_SECONDS_PER_TURN;
    controls.update();

    let turnRemaining = 0;
    let lastAzimuth = controls.getAzimuthalAngle();
    const stopTurntable = (): void => {
      controls.autoRotate = false;
      turnRemaining = 0;
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
      const headFrame = bodyMesh ? applyFacelessMannequin(bodyMesh) : null;
      if (bodyMesh) {
        paintMannequinUndergarment(bodyMesh);
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
      if (faceImage && bodyMesh && headFrame) {
        const decalGeometry = buildFaceDecalGeometry(bodyMesh, headFrame);
        if (decalGeometry) {
          const faceTexture = new THREE.CanvasTexture(faceImage);
          faceTexture.colorSpace = THREE.SRGBColorSpace;
          const decal = new THREE.Mesh(
            decalGeometry,
            new THREE.MeshStandardMaterial({
              map: faceTexture,
              transparent: true,
              depthWrite: false,
              roughness: 0.6,
              metalness: 0,
              polygonOffset: true,
              polygonOffsetFactor: -2,
            }),
          );
          bodyMesh.add(decal);
        }
      }

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
            fadeMaterials.forEach((material) => {
              material.opacity = Math.min(1, eased * 1.6);
            });
            camera.position.lerpVectors(startPosition, restPosition, eased);
          },
          done: () => {
            fadeMaterials.forEach((material) => {
              material.opacity = 1;
              material.transparent = false;
              material.needsUpdate = true;
            });
            if (turntableRef.current) {
              lastAzimuth = controls.getAzimuthalAngle();
              turnRemaining = Math.PI * 2;
              controls.autoRotate = true;
            }
            setBodyShown(true);
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

      if (controls.autoRotate) {
        const azimuth = controls.getAzimuthalAngle();
        let delta = Math.abs(azimuth - lastAzimuth);
        if (delta > Math.PI) {
          delta = Math.PI * 2 - delta;
        }
        lastAzimuth = azimuth;
        turnRemaining -= delta;
        if (turnRemaining <= 0) {
          stopTurntable();
        }
      }

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
  }, [faceImage, heightCm, parametric]);

  useEffect(() => {
    if (revealed && startRevealRef.current) {
      startRevealRef.current();
      startRevealRef.current = null;
    }
  }, [bodyVersion, revealed]);

  // Layer 2 — the garment. Rebuilds on drape / size / albedo changes without
  // touching the body; it dresses only once the body has faded in.
  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles || !bodyShown) {
      return;
    }

    let cancelled = false;
    setGarmentDraped(false);

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

      if (!geometry || cancelled) {
        geometry?.dispose();
        albedoMaterial.dispose();
        loadedAlbedo?.texture?.dispose();
        return;
      }

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
        },
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    albedoUrl,
    bodyShown,
    drapePayloadBase64,
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
