'use client';

import { useEffect, useRef, type FC } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// PBD cloth is an optional debug path. Storefront rendering uses AnnyCanvas.
import {
  createClothFaceIndices,
  createGarmentClothGrid,
  PbdClothSimulator,
} from '@/lib/graphics/pbd-cloth';
import { disposeRendererSession } from '@/lib/graphics/dispose-session';
import {
  computeVertexStrainColors,
  computeVertexStrains,
} from '@/lib/graphics/strain-heatmap';
import type { AvatarMeasurements, GarmentMeshProps, ViewportConfig } from '@/types/graphics';

export interface VFRCanvasProps {
  garment: GarmentMeshProps;
  config: ViewportConfig;
  avatar?: AvatarMeasurements;
  className?: string;
}

const CLOTH_WIDTH_SEGMENTS = 24;
const CLOTH_HEIGHT_SEGMENTS = 18;
const CLOTH_WIDTH = 0.9;
const CLOTH_HEIGHT = 0.75;
const CLOTH_ORIGIN_Y = 1.35;
const DEFAULT_AVATAR: AvatarMeasurements = {
  heightCm: 175,
  chestCm: 100,
  waistCm: 82,
};

export const VFRCanvas: FC<VFRCanvasProps> = ({
  garment,
  config,
  avatar = DEFAULT_AVATAR,
  className = 'w-full h-[560px] relative overflow-hidden rounded-xl bg-obsidian-canvas',
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const configRef = useRef<ViewportConfig>(config);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    const mountElement = mountRef.current;
    if (!mountElement) {
      return;
    }

    mountElement.innerHTML = '';

    const width = mountElement.clientWidth || 800;
    const height = mountElement.clientHeight || 560;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090d16);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 1.1, 2.8);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mountElement.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.target.set(0, 0.9, 0);
    controls.update();

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.15);
    keyLight.position.set(2.5, 4.5, 3.0);
    keyLight.castShadow = true;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x3b82f6, 0.35);
    fillLight.position.set(-2.0, 1.5, -2.5);
    scene.add(fillLight);

    const stageGroup = new THREE.Group();
    scene.add(stageGroup);

    const avatarHeight = (avatar.heightCm / DEFAULT_AVATAR.heightCm) * 1.2;
    const avatarChestRadius = (avatar.chestCm / DEFAULT_AVATAR.chestCm) * 0.3;
    const avatarWaistRadius = (avatar.waistCm / DEFAULT_AVATAR.waistCm) * 0.25;
    const avatarGeometry = new THREE.CylinderGeometry(
      avatarChestRadius,
      avatarWaistRadius,
      avatarHeight,
      48,
      1,
    );
    const avatarMaterial = new THREE.MeshStandardMaterial({
      color: 0xc4cad4,
      roughness: 0.65,
      metalness: 0.05,
    });
    const avatarMesh = new THREE.Mesh(avatarGeometry, avatarMaterial);
    avatarMesh.castShadow = true;
    avatarMesh.receiveShadow = true;
    avatarMesh.position.y = -0.2 + avatarHeight / 2;
    stageGroup.add(avatarMesh);

    const clothMeshData = createGarmentClothGrid(
      CLOTH_WIDTH_SEGMENTS,
      CLOTH_HEIGHT_SEGMENTS,
      CLOTH_WIDTH,
      CLOTH_HEIGHT,
      CLOTH_ORIGIN_Y,
    );

    const clothSimulator = PbdClothSimulator.withDefaults(clothMeshData, {
      tensileStiffness: garment.tensileStiffness,
      bendingRigidity: garment.bendingRigidity,
      shearStiffness: garment.shearStiffness,
      areaDensity: garment.areaDensity,
      collisionRadius: Math.max(avatarChestRadius, avatarWaistRadius) + 0.04,
    });

    const garmentGeometry = new THREE.BufferGeometry();
    garmentGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(clothSimulator.getPositions(), 3),
    );
    const clothFaceIndices = createClothFaceIndices(
      CLOTH_WIDTH_SEGMENTS,
      CLOTH_HEIGHT_SEGMENTS,
    );
    garmentGeometry.setIndex(new THREE.BufferAttribute(clothFaceIndices, 1));
    garmentGeometry.computeVertexNormals();

    const fabricTexture = new THREE.TextureLoader().load(garment.cadPatternUrl);
    fabricTexture.colorSpace = THREE.SRGBColorSpace;
    fabricTexture.wrapS = THREE.RepeatWrapping;
    fabricTexture.wrapT = THREE.RepeatWrapping;
    fabricTexture.repeat.set(2, 2);

    const fabricMaterial = new THREE.MeshStandardMaterial({
      map: fabricTexture,
      color: 0xffffff,
      roughness: 0.72,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });

    const heatmapMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.45,
      metalness: 0.08,
      side: THREE.DoubleSide,
    });

    const vertexCount = clothSimulator.getPositions().length / 3;
    const strainColorAttribute = new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3);
    garmentGeometry.setAttribute('color', strainColorAttribute);

    const garmentMesh = new THREE.Mesh(garmentGeometry, fabricMaterial);
    garmentMesh.castShadow = true;
    garmentMesh.receiveShadow = true;
    stageGroup.add(garmentMesh);

    const floorGeometry = new THREE.CircleGeometry(1.6, 48);
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.95,
      metalness: 0.0,
    });
    const floorMesh = new THREE.Mesh(floorGeometry, floorMaterial);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = -0.2;
    floorMesh.receiveShadow = true;
    stageGroup.add(floorMesh);

    let animationFrameId: number | null = null;
    const clock = new THREE.Clock();

    const warmUpSteps = 90;
    for (let step = 0; step < warmUpSteps; step += 1) {
      clothSimulator.step(1 / 60);
    }

    const animate = (): void => {
      animationFrameId = requestAnimationFrame(animate);

      const deltaSeconds = Math.min(clock.getDelta(), 0.033);
      clothSimulator.step(deltaSeconds);

      const positionAttribute = garmentGeometry.getAttribute('position') as THREE.BufferAttribute;
      positionAttribute.needsUpdate = true;
      garmentGeometry.computeVertexNormals();

      const strains = computeVertexStrains(
        clothSimulator.getRestPositions(),
        clothSimulator.getPositions(),
        clothFaceIndices,
      );
      const strainColors = computeVertexStrainColors(strains);
      strainColorAttribute.array.set(strainColors);
      strainColorAttribute.needsUpdate = true;

      const activeConfig = configRef.current;
      fabricMaterial.wireframe = activeConfig.showWireframe;
      heatmapMaterial.wireframe = activeConfig.showWireframe;
      garmentMesh.material = activeConfig.showHeatmap ? heatmapMaterial : fabricMaterial;

      if (activeConfig.autoRotate) {
        stageGroup.rotation.y += 0.008;
      }

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
      window.removeEventListener('resize', handleResize);
      disposeRendererSession({
        animationFrameId,
        controls,
        scene,
        renderer,
        mountElement,
        extras: [heatmapMaterial, fabricTexture],
      });
    };
  }, [
    avatar.chestCm,
    avatar.heightCm,
    avatar.waistCm,
    garment.areaDensity,
    garment.bendingRigidity,
    garment.cadPatternUrl,
    garment.shearStiffness,
    garment.tensileStiffness,
  ]);

  return <div ref={mountRef} className={className} />;
};
