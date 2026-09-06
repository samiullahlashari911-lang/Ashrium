import {
  MHR_LOD3_VERTEX_COUNT,
  MHR_LOD3_VERTEX_MAX,
  MHR_LOD3_VERTEX_MIN,
} from '@/types/hmr';

export interface RigidColliderMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

function clusterOnce(
  positions: Float32Array,
  indices: Uint32Array,
  cellSize: number,
): RigidColliderMesh {
  const vertexCount = positions.length / 3;
  const originX = minComponent(positions, 0);
  const originY = minComponent(positions, 1);
  const originZ = minComponent(positions, 2);
  const cell = Math.max(cellSize, 1e-6);
  const keyToCluster = new Map<string, number>();
  const remap = new Uint32Array(vertexCount);
  const clustered: number[] = [];

  for (let index = 0; index < vertexCount; index += 1) {
    const base = index * 3;
    const ix = Math.floor((positions[base] - originX) / cell);
    const iy = Math.floor((positions[base + 1] - originY) / cell);
    const iz = Math.floor((positions[base + 2] - originZ) / cell);
    const key = `${ix},${iy},${iz}`;
    let cluster = keyToCluster.get(key);
    if (cluster === undefined) {
      cluster = keyToCluster.size;
      keyToCluster.set(key, cluster);
      clustered.push(positions[base], positions[base + 1], positions[base + 2]);
    }
    remap[index] = cluster;
  }

  const faces: number[] = [];
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = remap[indices[offset]];
    const b = remap[indices[offset + 1]];
    const c = remap[indices[offset + 2]];
    if (a === b || b === c || c === a) {
      continue;
    }
    faces.push(a, b, c);
  }

  return {
    positions: new Float32Array(clustered),
    indices: new Uint32Array(faces),
  };
}

function minComponent(positions: Float32Array, axis: 0 | 1 | 2): number {
  let min = Number.POSITIVE_INFINITY;
  for (let index = axis; index < positions.length; index += 3) {
    min = Math.min(min, positions[index]);
  }
  return min;
}

function maxSpan(positions: Float32Array): number {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < positions.length; index += 3) {
    minX = Math.min(minX, positions[index]);
    minY = Math.min(minY, positions[index + 1]);
    minZ = Math.min(minZ, positions[index + 2]);
    maxX = Math.max(maxX, positions[index]);
    maxY = Math.max(maxY, positions[index + 1]);
    maxZ = Math.max(maxZ, positions[index + 2]);
  }
  return Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-4);
}

/**
 * Cluster-decimate LOD 1 (18,439) down to the MHR LOD 3 collider band (~4,899).
 */
export function decimateToMhrLod3(
  positions: Float32Array,
  indices: Uint32Array,
  targetCount: number = MHR_LOD3_VERTEX_COUNT,
): RigidColliderMesh {
  const vertexCount = positions.length / 3;
  if (vertexCount >= MHR_LOD3_VERTEX_MIN && vertexCount <= MHR_LOD3_VERTEX_MAX) {
    return { positions: positions.slice(), indices: indices.slice() };
  }

  if (vertexCount * 3 !== positions.length) {
    throw new Error('Collider positions must be xyz triplets.');
  }

  let cell = maxSpan(positions) / 42;
  let mesh = clusterOnce(positions, indices, cell);
  for (let step = 0; step < 10; step += 1) {
    const count = mesh.positions.length / 3;
    if (count > MHR_LOD3_VERTEX_MAX) {
      cell *= 1.18;
    } else if (count < MHR_LOD3_VERTEX_MIN) {
      cell *= 0.84;
    } else {
      break;
    }
    mesh = clusterOnce(positions, indices, cell);
  }

  const count = mesh.positions.length / 3;
  if (count < MHR_LOD3_VERTEX_MIN || count > MHR_LOD3_VERTEX_MAX) {
    throw new Error(
      `MHR LOD 3 collider must have ${MHR_LOD3_VERTEX_MIN}–${MHR_LOD3_VERTEX_MAX} vertices, got ${count} (target ${targetCount}).`,
    );
  }
  if (mesh.indices.length < 24) {
    throw new Error('MHR LOD 3 collider has too few faces.');
  }

  return mesh;
}
