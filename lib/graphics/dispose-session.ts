import * as THREE from 'three';

function disposeMaterial(material: THREE.Material): void {
  Object.values(material).forEach((value) => {
    if (value instanceof THREE.Texture) {
      value.dispose();
    }
  });
  material.dispose();
}

/**
 * Disposes geometry, materials, textures, and light shadow maps under `root`.
 * Covers Mesh, SkinnedMesh, Line, Points, and Sprite — not only Mesh.
 */
export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (
      node instanceof THREE.DirectionalLight
      || node instanceof THREE.SpotLight
      || node instanceof THREE.PointLight
    ) {
      node.shadow.map?.dispose();
    }

    const geometry = (node as THREE.Mesh).geometry;
    if (geometry && typeof geometry.dispose === 'function') {
      geometry.dispose();
    }

    const material = (node as THREE.Mesh).material;
    if (!material) {
      return;
    }

    const materials = Array.isArray(material) ? material : [material];
    materials.forEach(disposeMaterial);
  });
}

export function disposeWebGlRenderer(
  renderer: THREE.WebGLRenderer,
  mountElement: HTMLElement | null,
): void {
  renderer.forceContextLoss();
  renderer.dispose();

  const canvas = renderer.domElement;
  if (mountElement && canvas.parentNode === mountElement) {
    mountElement.removeChild(canvas);
  }
}

export function disposeRendererSession(input: {
  animationFrameId: number | null;
  controls?: { dispose(): void } | null;
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  mountElement: HTMLElement | null;
  extras?: Array<{ dispose(): void } | null | undefined>;
}): void {
  if (input.animationFrameId !== null) {
    cancelAnimationFrame(input.animationFrameId);
  }

  input.controls?.dispose();
  input.extras?.forEach((item) => item?.dispose());
  disposeObject3D(input.scene);
  input.scene.clear();
  disposeWebGlRenderer(input.renderer, input.mountElement);
}
