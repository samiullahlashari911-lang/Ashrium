'use client';

import { useEffect, useRef, useState, type FC } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { RadialHeatmapLegend } from '@/components/vfr/radial-heatmap-legend';
import { obsidianTitanium } from '@/lib/design-tokens';
import {
  applyFacelessMannequin,
  applyMannequinMaterial,
  buildAnnyGarmentGeometry,
  buildUndergarmentGeometry,
  createGarmentAlbedoMaterial,
  createUndergarmentMaterial,
  garmentCodeUvsFromPositions,
  type AnnyGarmentKind,
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

export interface AnnyCanvasGarment {
  kind: AnnyGarmentKind;
  chestCm: number;
  waistCm: number;
  hipCm: number;
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
  /** Client pixel QA can still fail after ingest; parent ORs this into Approximate. */
  onPrintQaFail?: () => void;
  className?: string;
}

interface LoadedAlbedo {
  qa: PrintQaResult;
  texture: THREE.Texture | null;
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

export const AnnyCanvas: FC<AnnyCanvasProps> = ({
  parametric,
  heightCm,
  garment = null,
  drapePayloadBase64 = null,
  onPrintQaFail,
  className = 'h-[560px] w-full overflow-hidden rounded-xl',
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const printQaFailRef = useRef(onPrintQaFail);
  printQaFailRef.current = onPrintQaFail;
  const [showClearanceHeatmap, setShowClearanceHeatmap] = useState(false);

  const garmentKind = garment?.kind;
  const garmentChestCm = garment?.chestCm;
  const garmentWaistCm = garment?.waistCm;
  const garmentHipCm = garment?.hipCm;
  const garmentEaseCm = garment?.easeCm;
  const albedoUrl = garment?.albedoUrl ?? null;
  const ingestPrintQaPassed = garment?.printQaPassed;

  useEffect(() => {
    const mountElement = mountRef.current;
    if (!mountElement) {
      return;
    }

    mountElement.innerHTML = '';

    const width = mountElement.clientWidth || 800;
    const height = mountElement.clientHeight || 560;
    let disposed = false;
    let animationFrameId: number | null = null;
    let strainMaterial: THREE.ShaderMaterial | null = null;
    let albedoTexture: THREE.Texture | null = null;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(obsidianTitanium.canvas);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 0.85, 3.1);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mountElement.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = 1.4;
    controls.maxDistance = 5.5;
    controls.target.set(0, 0.75, 0);
    controls.update();

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    keyLight.position.set(2.2, 4.2, 3.0);
    keyLight.castShadow = true;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(obsidianTitanium.accent, 0.32);
    fillLight.position.set(-2.2, 1.4, -2.4);
    scene.add(fillLight);

    const floorGeometry = new THREE.CircleGeometry(1.5, 48);
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: obsidianTitanium.card,
      roughness: 0.95,
      metalness: 0,
    });
    const floorMesh = new THREE.Mesh(floorGeometry, floorMaterial);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    const loader = new GLTFLoader();
    const hullPath = isMhrParametricVector(parametric)
      ? MHR_HULL_GLB_PUBLIC_PATH
      : ANNY_HULL_GLB_PUBLIC_PATH;

    const visualizationOff = ingestPrintQaPassed === false;

    void (async () => {
      let loadedAlbedo: LoadedAlbedo | null = null;
      if (!visualizationOff && albedoUrl) {
        loadedAlbedo = await inspectAlbedoImage(albedoUrl);
        if (disposed) {
          loadedAlbedo.texture?.dispose();
          return;
        }

        if (!loadedAlbedo.qa.passed) {
          loadedAlbedo.texture?.dispose();
          loadedAlbedo = { qa: loadedAlbedo.qa, texture: null };
          printQaFailRef.current?.();
        } else {
          albedoTexture = loadedAlbedo.texture;
        }
      }

      const showGarment = !visualizationOff && (loadedAlbedo === null || loadedAlbedo.qa.passed);

      let gltf: Awaited<ReturnType<GLTFLoader['loadAsync']>>;
      try {
        gltf = await loader.loadAsync(hullPath);
      } catch {
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
        return;
      }

      const bodyMesh = isMhrParametricVector(parametric)
        ? findMhrHullMesh(hull)
        : findAnnyHullMesh(hull);
      if (bodyMesh) {
        applyFacelessMannequin(bodyMesh);
      }

      const bounds = new THREE.Box3().setFromObject(hull);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      hull.position.sub(center);
      hull.position.y += size.y / 2;
      floorMesh.position.y = 0;
      controls.target.set(0, size.y * 0.48, 0);
      camera.position.set(0, size.y * 0.55, Math.max(2.4, size.y * 1.85));
      controls.update();

      scene.add(hull);

      hull.updateMatrixWorld(true);
      const hullMesh = findAnnyHullMesh(hull);
      if (hullMesh) {
        const undergarmentGeometry = buildUndergarmentGeometry(hullMesh);
        if (undergarmentGeometry) {
          const undergarment = new THREE.Mesh(undergarmentGeometry, createUndergarmentMaterial());
          undergarment.castShadow = true;
          undergarment.receiveShadow = true;
          scene.add(undergarment);
        }
      }

      if (!showGarment) {
        return;
      }

      const albedoMaterial = () => createGarmentAlbedoMaterial({
        map: loadedAlbedo?.texture ?? null,
        albedoHex: loadedAlbedo?.qa.albedoHex,
      });

      if (drapePayloadBase64) {
        try {
          const mesh = decodeSimDelta(simDeltaFromBase64(drapePayloadBase64));
          const positions = compositeSimPositions(mesh);
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          geometry.setAttribute('aClearanceCm', new THREE.BufferAttribute(mesh.clearanceCm, 1));
          geometry.setAttribute(
            'uv',
            new THREE.BufferAttribute(garmentCodeUvsFromPositions(mesh.restPositions), 2),
          );
          geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
          geometry.computeVertexNormals();
          const drapedMaterial = showClearanceHeatmap
            ? createFitShaderMaterial(garmentEaseCm ?? DEFAULT_EASE_CM)
            : albedoMaterial();
          if (showClearanceHeatmap) {
            strainMaterial = drapedMaterial as THREE.ShaderMaterial;
          }
          const draped = new THREE.Mesh(geometry, drapedMaterial);
          draped.position.copy(hull.position);
          draped.castShadow = true;
          draped.receiveShadow = true;
          scene.add(draped);
          return;
        } catch {
          // Fall through to approximate radial garment when delta decode fails.
        }
      }

      if (
        garmentKind === undefined
        || garmentChestCm === undefined
        || garmentWaistCm === undefined
        || garmentHipCm === undefined
        || garmentEaseCm === undefined
        || !hullMesh
      ) {
        return;
      }

      const garmentGeometry = buildAnnyGarmentGeometry(
        hullMesh,
        garmentKind,
        {
          chestCm: garmentChestCm,
          waistCm: garmentWaistCm,
          hipCm: garmentHipCm,
        },
        garmentEaseCm,
      );

      if (!garmentGeometry) {
        return;
      }

      const garmentMaterial = albedoMaterial();
      const garmentMesh = new THREE.Mesh(garmentGeometry, garmentMaterial);
      garmentMesh.castShadow = true;
      garmentMesh.receiveShadow = true;
      scene.add(garmentMesh);
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
      stopActivity();
      stopLoop();
      disposeRendererSession({
        animationFrameId,
        controls,
        scene,
        renderer,
        mountElement,
        extras: [strainMaterial, albedoTexture],
      });
    };
  }, [
    albedoUrl,
    drapePayloadBase64,
    garmentChestCm,
    garmentEaseCm,
    garmentHipCm,
    garmentKind,
    garmentWaistCm,
    heightCm,
    ingestPrintQaPassed,
    parametric,
    showClearanceHeatmap,
  ]);

  const heatmapAvailable = Boolean(drapePayloadBase64) && ingestPrintQaPassed !== false;

  return (
    <div className={`relative ${className}`}>
      <div ref={mountRef} className="h-full w-full" />
      {heatmapAvailable ? (
        <button
          type="button"
          aria-pressed={showClearanceHeatmap}
          onClick={() => setShowClearanceHeatmap((value) => !value)}
          className="absolute right-4 top-4 z-10 rounded-full border border-white/15 bg-obsidian-canvas/70 px-3 py-1.5 text-xs text-obsidian-muted backdrop-blur-md"
        >
          {showClearanceHeatmap ? 'Hide clearance' : 'Show clearance'}
        </button>
      ) : null}
      {showClearanceHeatmap && heatmapAvailable ? <RadialHeatmapLegend /> : null}
    </div>
  );
};
