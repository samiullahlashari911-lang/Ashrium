import * as THREE from 'three';

import {
  ANNY_PHENOTYPE_LABELS,
  ANNY_TOPOLOGY_VERSION,
  type AnnyParametricVector,
  type AnnyPhenotype,
} from '@/types/hmr';

/** Rest-pose height of the shipped `anny-hull.glb` bounding box, in meters. */
export const ANNY_HULL_REST_HEIGHT_M = 1.66589;

function applyPhenotypeToMesh(mesh: THREE.Mesh, phenotype: AnnyPhenotype): void {
  const influences = mesh.morphTargetInfluences;
  if (!influences || influences.length === 0) {
    return;
  }

  const dictionary = mesh.morphTargetDictionary;
  if (dictionary) {
    ANNY_PHENOTYPE_LABELS.forEach((label, index) => {
      if (label in dictionary) {
        influences[dictionary[label]] = phenotype[index];
      }
    });
    return;
  }

  const applied = Math.min(influences.length, phenotype.length);
  for (let index = 0; index < applied; index += 1) {
    influences[index] = phenotype[index];
  }
}

function applyJointRotations(root: THREE.Object3D, rotations: number[]): void {
  const bones: THREE.Bone[] = [];
  root.traverse((node) => {
    if (node instanceof THREE.Bone) {
      bones.push(node);
    }
  });

  if (bones.length === 0 || rotations.length === 0) {
    return;
  }

  if (rotations.length === bones.length * 4) {
    bones.forEach((bone, index) => {
      const offset = index * 4;
      bone.quaternion.set(
        rotations[offset],
        rotations[offset + 1],
        rotations[offset + 2],
        rotations[offset + 3],
      );
    });
    return;
  }

  if (rotations.length === bones.length * 3) {
    bones.forEach((bone, index) => {
      const offset = index * 3;
      bone.rotation.set(rotations[offset], rotations[offset + 1], rotations[offset + 2]);
    });
  }
}

/**
 * Applies whatever the live model + shipped GLB actually support:
 * morph targets (named or PCA-subset), skinned joints, and a one-shot height scale.
 * Does not assume a morph-target count.
 */
export function applyAnnyParametricDeform(
  root: THREE.Object3D,
  vector: AnnyParametricVector,
  heightCm: number,
): void {
  if (vector.topology_version !== ANNY_TOPOLOGY_VERSION) {
    throw new Error(
      `ANNY topology ${vector.topology_version} does not match shipped hull ${ANNY_TOPOLOGY_VERSION}`,
    );
  }

  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      applyPhenotypeToMesh(node, vector.phenotype);
    }
  });

  applyJointRotations(root, vector.joint_rotations);

  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  if (size.y <= 0) {
    return;
  }

  const targetHeight = heightCm / 100;
  root.scale.multiplyScalar(targetHeight / size.y);
}

export function findAnnyHullMesh(root: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((node) => {
    if (found || !(node instanceof THREE.Mesh)) {
      return;
    }

    const position = node.geometry.getAttribute('position');
    if (position && position.count > 0) {
      found = node;
    }
  });
  return found;
}

export { disposeObject3D } from '@/lib/graphics/dispose-session';
