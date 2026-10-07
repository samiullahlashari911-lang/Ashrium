'use client';

import { useEffect, useRef, useState, type JSX } from 'react';

import { subscribeViewportActivity } from '@/lib/graphics/viewport-activity';

const TURN_SECONDS = 14;

/**
 * Marketing hero: the real Ashrium mannequin (Meta MHR rest mesh, faceless,
 * porcelain, painted undergarment) on a slow turntable. Not a shopper's body
 * and no phenotype — just the mannequin shoppers will see. Three.js is
 * imported lazily so the page shell stays light; the loop pauses off-screen.
 */
export function MannequinShowcase({ className = '' }: { className?: string }): JSX.Element {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const mountElement = mountRef.current;
    if (!mountElement) {
      return;
    }

    let disposed = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const THREE = await import('three');
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const { applyFacelessMannequin, applyMannequinMaterial, paintMannequinUndergarment } = await import(
        '@/lib/graphics/anny-garment'
      );
      const { disposeRendererSession } = await import('@/lib/graphics/dispose-session');
      const { MHR_HULL_GLB_PUBLIC_PATH } = await import('@/types/hmr');
      if (disposed) {
        return;
      }

      const width = mountElement.clientWidth || 480;
      const height = mountElement.clientHeight || 560;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 50);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      mountElement.appendChild(renderer.domElement);

      scene.add(new THREE.HemisphereLight(0xffffff, 0xe9e2d8, 1.2));
      const key = new THREE.DirectionalLight(0xfff6ee, 1.6);
      key.position.set(2.4, 4.4, 3.2);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.radius = 6;
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xe4e8ff, 0.9);
      rim.position.set(-2.6, 2.6, -3);
      scene.add(rim);
      const floor = new THREE.Mesh(
        new THREE.CircleGeometry(1.4, 64),
        new THREE.ShadowMaterial({ opacity: 0.14 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      scene.add(floor);

      const pivot = new THREE.Group();
      scene.add(pivot);

      try {
        const gltf = await new GLTFLoader().loadAsync(MHR_HULL_GLB_PUBLIC_PATH);
        if (disposed) {
          return;
        }
        const hull = gltf.scene;
        applyMannequinMaterial(hull);
        hull.traverse((node) => {
          if (node instanceof THREE.Mesh) {
            applyFacelessMannequin(node);
            paintMannequinUndergarment(node);
          }
        });
        const bounds = new THREE.Box3().setFromObject(hull);
        const size = bounds.getSize(new THREE.Vector3());
        const centre = bounds.getCenter(new THREE.Vector3());
        hull.position.set(-centre.x, -bounds.min.y, -centre.z);
        pivot.add(hull);
        camera.position.set(0, size.y * 0.55, size.y * 2.35);
        camera.lookAt(0, size.y * 0.5, 0);
        setReady(true);
      } catch {
        // The hero still reads without the 3D mannequin.
      }

      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      let frameId: number | null = null;
      let last = performance.now();
      const loop = (now: number): void => {
        frameId = requestAnimationFrame(loop);
        const delta = (now - last) / 1000;
        last = now;
        if (!reducedMotion) {
          pivot.rotation.y += (delta * Math.PI * 2) / TURN_SECONDS;
        }
        renderer.render(scene, camera);
      };
      const stopActivity = subscribeViewportActivity(mountElement, (active) => {
        if (active && frameId === null) {
          last = performance.now();
          frameId = requestAnimationFrame(loop);
        } else if (!active && frameId !== null) {
          cancelAnimationFrame(frameId);
          frameId = null;
        }
      });
      const onResize = (): void => {
        const nextWidth = mountElement.clientWidth;
        const nextHeight = mountElement.clientHeight;
        camera.aspect = nextWidth / nextHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(nextWidth, nextHeight);
      };
      window.addEventListener('resize', onResize);

      cleanup = () => {
        window.removeEventListener('resize', onResize);
        stopActivity();
        disposeRendererSession({ animationFrameId: frameId, scene, renderer, mountElement });
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  return (
    <div className={`relative ${className}`}>
      <div ref={mountRef} className="h-full w-full" aria-hidden="true" />
      {!ready ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-ash-accent/20 border-t-ash-accent" />
        </div>
      ) : null}
    </div>
  );
}
