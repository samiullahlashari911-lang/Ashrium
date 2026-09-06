import * as THREE from 'three';

import { albedoHexToRgbInteger } from '@/lib/graphics/print-qa';
import { computeRadialHeatmapColors } from '@/lib/graphics/radial-heatmap';

export type AnnyGarmentKind = 'tee' | 'pant' | 'dress';

/** Cool stone, not skin. GDPR Art. 9 — do not infer a shopper's complexion. */
export const MANNEQUIN_COLOR = 0x8a90a3;
/** Neutral charcoal undergarment so the body is not a nude grey mesh. */
export const UNDERGARMENT_COLOR = 0x2a2d38;
export const MANNEQUIN_HEAD_START_T = 0.84;
const UNDERGARMENT_THICKNESS_M = 0.004;

export interface AnnyGarmentSize {
  chestCm: number;
  waistCm: number;
  hipCm: number;
}

const SLICE_BINS = 48;
const FABRIC_THICKNESS_M = 0.006;

function girthRadiusM(circumferenceCm: number): number {
  return circumferenceCm / 100 / (2 * Math.PI);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function vertexInRegion(t: number, kind: AnnyGarmentKind): boolean {
  if (kind === 'pant') {
    return t >= 0.02 && t <= 0.58;
  }

  if (kind === 'dress') {
    return t >= 0.18 && t <= 0.86;
  }

  return t >= 0.47 && t <= 0.86;
}

function sizeRadiusAtT(t: number, size: AnnyGarmentSize): number {
  const chestT = 0.72;
  const waistT = 0.58;
  const hipT = 0.5;
  const chestR = girthRadiusM(size.chestCm);
  const waistR = girthRadiusM(size.waistCm);
  const hipR = girthRadiusM(size.hipCm);
  const ankleR = hipR * 0.55;

  if (t >= chestT) {
    return lerp(chestR, chestR * 0.72, Math.min((t - chestT) / 0.14, 1));
  }

  if (t >= waistT) {
    return lerp(waistR, chestR, (t - waistT) / (chestT - waistT));
  }

  if (t >= hipT) {
    return lerp(hipR, waistR, (t - hipT) / (waistT - hipT));
  }

  return lerp(ankleR, hipR, t / hipT);
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  return sorted[mid];
}

function readIndexArray(geometry: THREE.BufferGeometry): Uint32Array {
  const index = geometry.getIndex();
  if (!index) {
    const count = geometry.getAttribute('position').count;
    const sequential = new Uint32Array(count);
    for (let cursor = 0; cursor < count; cursor += 1) {
      sequential[cursor] = cursor;
    }
    return sequential;
  }

  const source = index.array;
  const copy = new Uint32Array(source.length);
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    copy[cursor] = source[cursor];
  }
  return copy;
}

/**
 * Builds a tee, pant, or dress shell from the deformed ANNY hull.
 * Vertices stay bound to hull topology; radial offset follows recommended girths.
 */
export function buildAnnyGarmentGeometry(
  hullMesh: THREE.Mesh,
  kind: AnnyGarmentKind,
  size: AnnyGarmentSize,
  easeCm: number,
): THREE.BufferGeometry | null {
  const positionAttr = hullMesh.geometry.getAttribute('position');
  if (!positionAttr || positionAttr.count < 3) {
    return null;
  }

  const vertexCount = positionAttr.count;
  const world = new Float32Array(vertexCount * 3);
  const scratch = new THREE.Vector3();

  for (let index = 0; index < vertexCount; index += 1) {
    hullMesh.getVertexPosition(index, scratch);
    if (hullMesh instanceof THREE.SkinnedMesh) {
      hullMesh.applyBoneTransform(index, scratch);
    }
    hullMesh.localToWorld(scratch);
    const base = index * 3;
    world[base] = scratch.x;
    world[base + 1] = scratch.y;
    world[base + 2] = scratch.z;
  }

  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < vertexCount; index += 1) {
    const y = world[index * 3 + 1];
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
  }

  const height = yMax - yMin;
  if (height <= 1e-4) {
    return null;
  }

  const radii = new Float32Array(vertexCount);
  const ts = new Float32Array(vertexCount);
  for (let index = 0; index < vertexCount; index += 1) {
    const base = index * 3;
    const x = world[base];
    const y = world[base + 1];
    const z = world[base + 2];
    ts[index] = (y - yMin) / height;
    radii[index] = Math.hypot(x, z);
  }

  const binValues: number[][] = Array.from({ length: SLICE_BINS }, () => []);
  for (let index = 0; index < vertexCount; index += 1) {
    const bin = Math.min(SLICE_BINS - 1, Math.floor(ts[index] * SLICE_BINS));
    binValues[bin].push(radii[index]);
  }

  const sliceMedian = new Float32Array(SLICE_BINS);
  for (let bin = 0; bin < SLICE_BINS; bin += 1) {
    const values = binValues[bin];
    const cutoff = values.length === 0 ? 0 : [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.55)];
    const core = values.filter((value) => value <= cutoff * 1.08 + 1e-6);
    sliceMedian[bin] = median(core.length > 0 ? core : values);
  }

  const included = new Uint8Array(vertexCount);
  for (let index = 0; index < vertexCount; index += 1) {
    included[index] = vertexInRegion(ts[index], kind) ? 1 : 0;
  }

  const sourceIndex = readIndexArray(hullMesh.geometry);
  const compactFaces: number[] = [];
  const oldToNew = new Int32Array(vertexCount).fill(-1);
  const used: number[] = [];

  const remember = (vertex: number): number => {
    if (oldToNew[vertex] >= 0) {
      return oldToNew[vertex];
    }

    const next = used.length;
    oldToNew[vertex] = next;
    used.push(vertex);
    return next;
  };

  for (let offset = 0; offset + 2 < sourceIndex.length; offset += 3) {
    const a = sourceIndex[offset];
    const b = sourceIndex[offset + 1];
    const c = sourceIndex[offset + 2];
    if (!included[a] || !included[b] || !included[c]) {
      continue;
    }

    compactFaces.push(remember(a), remember(b), remember(c));
  }

  if (used.length < 3 || compactFaces.length < 3) {
    return null;
  }

  const positions = new Float32Array(used.length * 3);
  const clearances = new Float32Array(used.length);
  const normals = new Float32Array(used.length * 3);

  for (let compact = 0; compact < used.length; compact += 1) {
    const source = used[compact];
    const base = source * 3;
    const x = world[base];
    const y = world[base + 1];
    const z = world[base + 2];
    const t = ts[source];
    const bodyR = radii[source];
    const bin = Math.min(SLICE_BINS - 1, Math.floor(t * SLICE_BINS));
    const torsoR = sliceMedian[bin] > 1e-5 ? sliceMedian[bin] : bodyR;
    const targetR = sizeRadiusAtT(t, size);
    const radialClearanceM = targetR - torsoR;
    clearances[compact] = radialClearanceM * 100;

    const dirLen = Math.hypot(x, z);
    const nx = dirLen > 1e-6 ? x / dirLen : 0;
    const nz = dirLen > 1e-6 ? z / dirLen : 0;
    const offset = Math.max(FABRIC_THICKNESS_M, radialClearanceM);
    const outR = bodyR + offset;
    const outBase = compact * 3;
    positions[outBase] = nx * outR;
    positions[outBase + 1] = y;
    positions[outBase + 2] = nz * outR;
    normals[outBase] = nx;
    normals[outBase + 1] = 0;
    normals[outBase + 2] = nz;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute(
    'color',
    new THREE.BufferAttribute(computeRadialHeatmapColors(clearances, easeCm), 3),
  );
  geometry.setAttribute('uv', new THREE.BufferAttribute(garmentCodeUvsFromPositions(positions), 2));
  geometry.setIndex(compactFaces);
  geometry.computeVertexNormals();

  return geometry;
}

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

/**
 * Replaces the head with a featureless dome so the avatar is a mannequin,
 * not a face. Mutates the xyz buffer in place.
 */
export function sealMannequinHead(
  positions: Float32Array,
  headStartT: number = MANNEQUIN_HEAD_START_T,
): void {
  const vertexCount = Math.floor(positions.length / 3);
  if (vertexCount < 3) {
    return;
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
    return;
  }

  const neckY = yMin + height * headStartT;
  const neckBand = height * 0.02;
  const neckRadii: number[] = [];
  for (let index = 0; index < vertexCount; index += 1) {
    const base = index * 3;
    const y = positions[base + 1];
    if (Math.abs(y - neckY) <= neckBand) {
      neckRadii.push(Math.hypot(positions[base], positions[base + 2]));
    }
  }

  neckRadii.sort((left, right) => left - right);
  const neckR = neckRadii.length > 0
    ? neckRadii[Math.floor(neckRadii.length / 2)]
    : height * 0.055;
  const capHeight = neckR * 0.42;
  const capRadius = neckR * 0.7;

  for (let index = 0; index < vertexCount; index += 1) {
    const base = index * 3;
    const x = positions[base];
    const y = positions[base + 1];
    const z = positions[base + 2];
    if (y <= neckY) {
      continue;
    }

    const t = Math.min((y - neckY) / Math.max(yMax - neckY, 1e-5), 1);
    const radius = Math.hypot(x, z);
    const nx = radius > 1e-6 ? x / radius : 0;
    const nz = radius > 1e-6 ? z / radius : 1;
    const dome = Math.sqrt(Math.max(0, 1 - t * t));
    positions[base] = nx * capRadius * dome;
    positions[base + 1] = neckY + capHeight * t;
    positions[base + 2] = nz * capRadius * dome;
  }
}

export function applyFacelessMannequin(mesh: THREE.Mesh): void {
  const position = mesh.geometry.getAttribute('position');
  if (!position || position.count < 3) {
    return;
  }

  const array = position.array;
  if (!(array instanceof Float32Array)) {
    return;
  }

  sealMannequinHead(array);
  position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
}

export function createMannequinMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: MANNEQUIN_COLOR,
    roughness: 0.88,
    metalness: 0.02,
  });
}

export function createUndergarmentMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: UNDERGARMENT_COLOR,
    roughness: 0.78,
    metalness: 0,
    side: THREE.DoubleSide,
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

function vertexInUndergarment(t: number): boolean {
  return t >= 0.46 && t <= 0.8;
}

/** Neutral tank/brief layer so the mannequin is not a nude grey mesh. */
export function buildUndergarmentGeometry(hullMesh: THREE.Mesh): THREE.BufferGeometry | null {
  const positionAttr = hullMesh.geometry.getAttribute('position');
  if (!positionAttr || positionAttr.count < 3) {
    return null;
  }

  const vertexCount = positionAttr.count;
  const world = new Float32Array(vertexCount * 3);
  const scratch = new THREE.Vector3();

  for (let index = 0; index < vertexCount; index += 1) {
    hullMesh.getVertexPosition(index, scratch);
    if (hullMesh instanceof THREE.SkinnedMesh) {
      hullMesh.applyBoneTransform(index, scratch);
    }
    hullMesh.localToWorld(scratch);
    const base = index * 3;
    world[base] = scratch.x;
    world[base + 1] = scratch.y;
    world[base + 2] = scratch.z;
  }

  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < vertexCount; index += 1) {
    const y = world[index * 3 + 1];
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
  }

  const height = yMax - yMin;
  if (height <= 1e-4) {
    return null;
  }

  const included = new Uint8Array(vertexCount);
  for (let index = 0; index < vertexCount; index += 1) {
    const t = (world[index * 3 + 1] - yMin) / height;
    included[index] = vertexInUndergarment(t) ? 1 : 0;
  }

  const sourceIndex = readIndexArray(hullMesh.geometry);
  const compactFaces: number[] = [];
  const oldToNew = new Int32Array(vertexCount).fill(-1);
  const used: number[] = [];

  const remember = (vertex: number): number => {
    if (oldToNew[vertex] >= 0) {
      return oldToNew[vertex];
    }

    const next = used.length;
    oldToNew[vertex] = next;
    used.push(vertex);
    return next;
  };

  for (let offset = 0; offset + 2 < sourceIndex.length; offset += 3) {
    const a = sourceIndex[offset];
    const b = sourceIndex[offset + 1];
    const c = sourceIndex[offset + 2];
    if (!included[a] || !included[b] || !included[c]) {
      continue;
    }

    compactFaces.push(remember(a), remember(b), remember(c));
  }

  if (used.length < 3 || compactFaces.length < 3) {
    return null;
  }

  const positions = new Float32Array(used.length * 3);
  for (let compact = 0; compact < used.length; compact += 1) {
    const source = used[compact];
    const base = source * 3;
    const x = world[base];
    const y = world[base + 1];
    const z = world[base + 2];
    const dirLen = Math.hypot(x, z);
    const nx = dirLen > 1e-6 ? x / dirLen : 0;
    const nz = dirLen > 1e-6 ? z / dirLen : 0;
    const bodyR = dirLen;
    const outBase = compact * 3;
    positions[outBase] = nx * (bodyR + UNDERGARMENT_THICKNESS_M);
    positions[outBase + 1] = y;
    positions[outBase + 2] = nz * (bodyR + UNDERGARMENT_THICKNESS_M);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(compactFaces);
  geometry.computeVertexNormals();
  return geometry;
}
