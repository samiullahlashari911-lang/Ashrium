import * as THREE from 'three';

import { albedoHexToRgbInteger } from '@/lib/graphics/print-qa';

/** Porcelain gallery white, not skin. GDPR Art. 9 — do not infer a shopper's complexion. */
export const MANNEQUIN_COLOR = 0xe8e8ec;
/** Neutral charcoal undergarment so the body is not a nude grey mesh. */
export const UNDERGARMENT_COLOR = 0x3a3c46;
export const MANNEQUIN_HEAD_START_T = 0.84;

/**
 * Cylindrical UVs matching the GarmentCode rest-length wrap
 * (`rows × ring_columns` from the 2D pattern). u is around the body, v is up.
 */
export function garmentCodeUvsFromPositions(positions: Float32Array): Float32Array {
  const vertexCount = Math.floor(positions.length / 3);
  const uvs = new Float32Array(vertexCount * 2);
  if (vertexCount === 0) {
    return uvs;
  }

  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < vertexCount; index += 1) {
    const y = positions[index * 3 + 1];
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
  }

  const height = Math.max(yMax - yMin, 1e-5);
  for (let index = 0; index < vertexCount; index += 1) {
    const base = index * 3;
    const x = positions[base];
    const y = positions[base + 1];
    const z = positions[base + 2];
    const angle = Math.atan2(x, z);
    uvs[index * 2] = (angle / (Math.PI * 2) + 1) % 1;
    uvs[index * 2 + 1] = (y - yMin) / height;
  }

  return uvs;
}

/** The sculpted mannequin head: an ellipsoid from chin to crown (mesh space). */
export interface MannequinHeadFrame {
  centreX: number;
  centreY: number;
  centreZ: number;
  semiX: number;
  semiY: number;
  semiZ: number;
  chinY: number;
  crownY: number;
}

/** Chin height as a fraction of stature; the head ellipsoid spans chin → crown. */
const MANNEQUIN_CHIN_T = 0.865;

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * (sorted.length - 1)))];
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / Math.max(edge1 - edge0, 1e-6)));
  return t * t * (3 - 2 * t);
}

/**
 * Sculpts the head into a smooth gallery-mannequin ellipsoid sized to the
 * shopper's own head: nose, lips, brows, and ears are projected onto the
 * surface, so the avatar keeps a natural head without a face. Blends through
 * the neck so there is no seam. Mutates the xyz buffer in place.
 */
export function sealMannequinHead(
  positions: Float32Array,
  headStartT: number = MANNEQUIN_HEAD_START_T,
): MannequinHeadFrame | null {
  const vertexCount = Math.floor(positions.length / 3);
  if (vertexCount < 3) {
    return null;
  }

  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < vertexCount; index += 1) {
    const y = positions[index * 3 + 1];
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
  }

  const height = yMax - yMin;
  if (height <= 1e-4) {
    return null;
  }

  const neckY = yMin + height * headStartT;
  const chinY = Math.max(neckY + height * 0.005, yMin + height * MANNEQUIN_CHIN_T);
  const headXs: number[] = [];
  const headZs: number[] = [];
  for (let index = 0; index < vertexCount; index += 1) {
    const base = index * 3;
    if (positions[base + 1] >= chinY) {
      headXs.push(positions[base]);
      headZs.push(positions[base + 2]);
    }
  }
  if (headXs.length === 0) {
    return null;
  }

  const centreX = (percentile(headXs, 0.05) + percentile(headXs, 0.95)) / 2;
  const centreZ = (percentile(headZs, 0.05) + percentile(headZs, 0.95)) / 2;
  // Percentiles ignore ears and the nose tip when sizing the skull.
  const semiX = Math.min(
    Math.max(percentile(headXs.map((x) => Math.abs(x - centreX)), 0.85), height * 0.035),
    height * 0.06,
  );
  const semiZ = Math.min(
    Math.max(percentile(headZs.map((z) => Math.abs(z - centreZ)), 0.85), height * 0.045),
    height * 0.07,
  );
  const semiY = (yMax - chinY) / 2;
  const centreY = yMax - semiY;

  for (let index = 0; index < vertexCount; index += 1) {
    const base = index * 3;
    const x = positions[base];
    const y = positions[base + 1];
    const z = positions[base + 2];
    if (y <= neckY) {
      continue;
    }

    const dx = x - centreX;
    const dy = Math.max(y, chinY - semiY * 0.6) - centreY;
    const dz = z - centreZ;
    const reach = Math.sqrt((dx / semiX) ** 2 + (dy / semiY) ** 2 + (dz / semiZ) ** 2);
    if (reach <= 1e-6) {
      continue;
    }
    const projectedX = centreX + dx / reach;
    const projectedY = centreY + dy / reach;
    const projectedZ = centreZ + dz / reach;
    const weight = smoothstep(neckY, chinY, y);
    positions[base] = x + (projectedX - x) * weight;
    positions[base + 1] = y + (projectedY - y) * weight;
    positions[base + 2] = z + (projectedZ - z) * weight;
  }

  return { centreX, centreY, centreZ, semiX, semiY, semiZ, chinY, crownY: yMax };
}

export function applyFacelessMannequin(mesh: THREE.Mesh): MannequinHeadFrame | null {
  const position = mesh.geometry.getAttribute('position');
  if (!position || position.count < 3) {
    return null;
  }

  const array = position.array;
  if (!(array instanceof Float32Array)) {
    return null;
  }

  const frame = sealMannequinHead(array);
  position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
  return frame;
}

/**
 * Face decal for the on-device face: the front half of the sculpted head,
 * lifted 1.5 mm off the surface, with UVs projected straight on from the
 * camera so the shopper's front photo lands where it was taken.
 */
export function buildFaceDecalGeometry(
  mesh: THREE.Mesh,
  frame: MannequinHeadFrame,
): THREE.BufferGeometry | null {
  const position = mesh.geometry.getAttribute('position');
  const normal = mesh.geometry.getAttribute('normal');
  const index = mesh.geometry.getIndex();
  if (!position || !normal || !index) {
    return null;
  }

  const inFront = (vertex: number): boolean =>
    position.getY(vertex) >= frame.chinY - frame.semiY * 0.15
    && position.getZ(vertex) >= frame.centreZ - frame.semiZ * 0.1;

  const remap = new Map<number, number>();
  const positions: number[] = [];
  const uvs: number[] = [];
  const faces: number[] = [];
  const lift = 0.0015;
  const keep = (vertex: number): number => {
    const known = remap.get(vertex);
    if (known !== undefined) {
      return known;
    }
    const x = position.getX(vertex);
    const y = position.getY(vertex);
    const z = position.getZ(vertex);
    positions.push(x + normal.getX(vertex) * lift, y + normal.getY(vertex) * lift, z + normal.getZ(vertex) * lift);
    uvs.push(
      0.5 + (x - frame.centreX) / (2.1 * frame.semiX),
      (y - (frame.chinY - frame.semiY * 0.15)) / (frame.crownY - frame.chinY + frame.semiY * 0.15),
    );
    const next = remap.size;
    remap.set(vertex, next);
    return next;
  };

  for (let cursor = 0; cursor + 2 < index.count; cursor += 3) {
    const a = index.getX(cursor);
    const b = index.getX(cursor + 1);
    const c = index.getX(cursor + 2);
    if (inFront(a) && inFront(b) && inFront(c)) {
      faces.push(keep(a), keep(b), keep(c));
    }
  }
  if (faces.length < 3) {
    return null;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(faces);
  geometry.computeVertexNormals();
  return geometry;
}

export function createMannequinMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: MANNEQUIN_COLOR,
    roughness: 0.46,
    metalness: 0.0,
  });
}

export function createGarmentAlbedoMaterial(input: {
  map?: THREE.Texture | null;
  albedoHex?: string | null;
}): THREE.MeshStandardMaterial {
  const hasMap = Boolean(input.map);
  return new THREE.MeshStandardMaterial({
    map: input.map ?? null,
    color: hasMap ? 0xffffff : albedoHexToRgbInteger(input.albedoHex ?? '#5c5348'),
    roughness: 0.64,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
}

export function applyMannequinMaterial(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) {
      return;
    }

    const previous = node.material;
    node.material = createMannequinMaterial();
    node.castShadow = true;
    node.receiveShadow = true;
    if (Array.isArray(previous)) {
      previous.forEach((material) => material.dispose());
    } else if (previous) {
      previous.dispose();
    }
  });
}

/** Soft band 0→1→0 between lo and hi with `feather` fade on both edges. */
function band(value: number, lo: number, hi: number, feather: number): number {
  const rise = Math.min(1, Math.max(0, (value - lo) / feather));
  const fall = Math.min(1, Math.max(0, (hi - value) / feather));
  return Math.min(rise, fall);
}

/**
 * Paints a neutral graphite tank and briefs onto the mannequin as vertex
 * colours, with feathered edges, so the body is never a nude mesh and there
 * is no separate shell to z-fight. Bands are fractions of stature; arms and
 * hands are excluded by distance from the body's centre line.
 */
export function paintMannequinUndergarment(mesh: THREE.Mesh): void {
  const position = mesh.geometry.getAttribute('position');
  if (!position || position.count < 3) {
    return;
  }

  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  let xSum = 0;
  for (let index = 0; index < position.count; index += 1) {
    const y = position.getY(index);
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
    xSum += position.getX(index);
  }
  const height = yMax - yMin;
  if (height <= 1e-4) {
    return;
  }

  const centreX = xSum / position.count;
  const skin = new THREE.Color(MANNEQUIN_COLOR);
  const garment = new THREE.Color(UNDERGARMENT_COLOR);
  const colors = new Float32Array(position.count * 3);
  const feather = height * 0.014;
  const mixed = new THREE.Color();
  for (let index = 0; index < position.count; index += 1) {
    const y = position.getY(index) - yMin;
    const lateral = Math.abs(position.getX(index) - centreX);
    const briefs = band(y, height * 0.458, height * 0.565, feather)
      * band(-lateral, -height * 0.13, height, feather);
    const top = band(y, height * 0.668, height * 0.778, feather)
      * band(-lateral, -height * 0.104, height, feather);
    mixed.copy(skin).lerp(garment, Math.max(briefs, top));
    colors[index * 3] = mixed.r;
    colors[index * 3 + 1] = mixed.g;
    colors[index * 3 + 2] = mixed.b;
  }

  mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  materials.forEach((material) => {
    if (material instanceof THREE.MeshStandardMaterial) {
      material.color.set(0xffffff);
      material.vertexColors = true;
      material.needsUpdate = true;
    }
  });
}
