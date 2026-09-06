'use client';

import { useEffect, useRef, type FC } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { RadialHeatmapLegend } from '@/components/vfr/radial-heatmap-legend';
import { obsidianTitanium } from '@/lib/design-tokens';
import { buildAnnyGarmentGeometry, type AnnyGarmentKind } from '@/lib/graphics/anny-garment';
import { applyAnnyParametricDeform, findAnnyHullMesh } from '@/lib/graphics/anny-hull';
import { disposeObject3D, disposeRendererSession } from '@/lib/graphics/dispose-session';
import {
  compositeSimPositions,
  decodeSimDelta,
  simDeltaFromBase64,
} from '@/lib/graphics/meshopt-delta';
import { DEFAULT_EASE_CM } from '@/lib/graphics/radial-heatmap';
import { createFitShaderMaterial } from '@/lib/graphics/strain-shader';
import { ANNY_HULL_GLB_PUBLIC_PATH, type AnnyParametricVector } from '@/types/hmr';

export interface AnnyCanvasGarment {
  kind: AnnyGarmentKind;
  chestCm: number;
  waistCm: number;
  hipCm: number;
  easeCm: number;
}

export interface AnnyCanvasProps {
  parametric: AnnyParametricVector;
  heightCm: number;
  garment?: AnnyCanvasGarment | null;
  /** Base64 meshopt delta from /api/v1/fit/resolve. When set, V_final = V_0 + ΔX. */
  drapePayloadBase64?: string | null;
  className?: string;
}

export const AnnyCanvas: FC<AnnyCanvasProps> = ({
  parametric,
  heightCm,
  garment = null,
  drapePayloadBase64 = null,
  className = 'h-[560px] w-full overflow-hidden rounded-xl',
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  const garmentKind = garment?.kind;
  const garmentChestCm = garment?.chestCm;
  const garmentWaistCm = garment?.waistCm;
  const garmentHipCm = garment?.hipCm;
  const garmentEaseCm = garment?.easeCm;

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
    void loader.loadAsync(ANNY_HULL_GLB_PUBLIC_PATH).then((gltf) => {
      if (disposed) {
        disposeObject3D(gltf.scene);
        return;
      }

      const hull = gltf.scene;
      hull.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.castShadow = true;
          node.receiveShadow = true;
          if (node.material instanceof THREE.MeshStandardMaterial) {
            node.material.color.set(0xc5cad3);
            node.material.roughness = 0.62;
            node.material.metalness = 0.04;
          }
        }
      });

      try {
        applyAnnyParametricDeform(hull, parametric, heightCm);
      } catch {
        disposeObject3D(hull);
        return;
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

      if (drapePayloadBase64) {
        try {
          const mesh = decodeSimDelta(simDeltaFromBase64(drapePayloadBase64));
          const positions = compositeSimPositions(mesh);
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          geometry.setAttribute('aClearanceCm', new THREE.BufferAttribute(mesh.clearanceCm, 1));
          geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
          geometry.computeVertexNormals();
          strainMaterial = createFitShaderMaterial(garmentEaseCm ?? DEFAULT_EASE_CM);
          const draped = new THREE.Mesh(geometry, strainMaterial);
          // XPBD positions are already height-scaled server-side. Apply only
          // the root translation used to center the visible ANNY hull.
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
      ) {
        return;
      }

      hull.updateMatrixWorld(true);
      const hullMesh = findAnnyHullMesh(hull);
      if (!hullMesh) {
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

      const garmentMaterial = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.48,
        metalness: 0.04,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.88,
      });
      const garmentMesh = new THREE.Mesh(garmentGeometry, garmentMaterial);
      garmentMesh.castShadow = true;
      garmentMesh.receiveShadow = true;
      scene.add(garmentMesh);
    });

    const animate = (): void => {
      animationFrameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };

    animate();

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
      disposeRendererSession({
        animationFrameId,
        controls,
        scene,
        renderer,
        mountElement,
        extras: [strainMaterial],
      });
    };
  }, [
    drapePayloadBase64,
    garmentChestCm,
    garmentEaseCm,
    garmentHipCm,
    garmentKind,
    garmentWaistCm,
    heightCm,
    parametric,
  ]);

  return (
    <div className={`relative ${className}`}>
      <div ref={mountRef} className="h-full w-full" />
      {garment || drapePayloadBase64 ? <RadialHeatmapLegend /> : null}
    </div>
  );
};
