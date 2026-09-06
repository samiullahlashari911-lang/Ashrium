import * as THREE from 'three';

import {
  ANNY_PHENOTYPE_LABELS,
  ANNY_TOPOLOGY_VERSION,
  MHR_TOPOLOGY_VERSION,
  MHR_VERTEX_COUNT,
  type AnnyParametricVector,
  type AnnyPhenotype,
  type MhrParametricVector,
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

/** Cog vertex buffers are centimetres; extent under 8 is already metres. */
export function vertexBufferToMeters(values: readonly number[]): Float32Array {
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 1; index < values.length; index += 3) {
    minY = Math.min(minY, values[index]);
    maxY = Math.max(maxY, values[index]);
  }

  const scale = maxY - minY < 8 ? 1 : 0.01;
  const meters = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    meters[index] = values[index] * scale;
  }

  return meters;
}

export function findMhrHullMesh(root: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((node) => {
    if (found || !(node instanceof THREE.Mesh)) {
      return;
    }

    const position = node.geometry.getAttribute('position');
    if (position && position.count === MHR_VERTEX_COUNT) {
      found = node;
    }
  });
  return found;
}

/**
 * Writes Cog `vertex_positions` onto the shipped MHR hull. Does not height-scale
 * a dummy mesh. Missing vertices leave the official rest-pose LOD 1 in place.
 */
export function applyMhrVertexPositions(
  root: THREE.Object3D,
  vector: MhrParametricVector,
): void {
  if (vector.topology_version !== MHR_TOPOLOGY_VERSION) {
    throw new Error(
      `MHR topology ${vector.topology_version} does not match shipped hull ${MHR_TOPOLOGY_VERSION}`,
    );
  }

  const mesh = findMhrHullMesh(root);
  if (!mesh) {
    throw new Error(`Shipped MHR hull does not have ${MHR_VERTEX_COUNT} vertices.`);
  }

  if (!vector.vertex_positions) {
    return;
  }

  const position = mesh.geometry.getAttribute('position');
  const meters = vertexBufferToMeters(vector.vertex_positions);
  if (!position || position.count !== MHR_VERTEX_COUNT || position.array.length !== meters.length) {
    throw new Error('MHR vertex_positions do not match the shipped LOD 1 hull.');
  }

  (position.array as Float32Array).set(meters);
  position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
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
