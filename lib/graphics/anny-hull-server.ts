import { promises as fs } from 'node:fs';
import path from 'node:path';

import { ANNY_HULL_REST_HEIGHT_M } from '@/lib/graphics/anny-hull';
import {
  ANNY_JOINT_COUNT,
  ANNY_PHENOTYPE_DIM,
  ANNY_TOPOLOGY_VERSION,
  ANNY_VERTEX_COUNT,
  MHR_JOINT_COUNT,
  MHR_TOPOLOGY_VERSION,
  MHR_VERTEX_COUNT,
  type AnnyDerivedMeasurements,
  type AnnyParametricVector,
} from '@/types/hmr';
import type { HullCollisionField } from '@/types/graphics';

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

interface GlbJson {
  asset?: {
    generator?: string;
  };
  extras?: {
    topology_version?: unknown;
    vertex_count?: unknown;
    joint_count?: unknown;
  };
  accessors: Array<{
    bufferView: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: string;
  }>;
  bufferViews: Array<{
    buffer: number;
    byteOffset?: number;
    byteLength: number;
  }>;
  meshes: Array<{
    primitives: Array<{
      attributes: { POSITION: number };
      indices: number;
    }>;
  }>;
  skins?: Array<{
    joints?: number[];
  }>;
}

export interface ShippedAnnyHullStamp {
  topologyVersion: string;
  vertexCount: number;
  stampedJointCount: number | null;
  embeddedJointCount: number;
  generator: string | null;
  matchesShippedTopology: boolean;
}

export interface AnnyHullGeometry {
  positions: Float32Array;
  indices: Uint32Array;
  topologyVersion: typeof ANNY_TOPOLOGY_VERSION;
}

export interface MhrHullGeometry {
  positions: Float32Array;
  indices: Uint32Array;
  topologyVersion: typeof MHR_TOPOLOGY_VERSION;
}

let cachedHull: AnnyHullGeometry | null = null;
let cachedMhrHull: MhrHullGeometry | null = null;

function readGlbJsonAndBin(buffer: Buffer): { json: GlbJson; bin: Buffer } {
  if (buffer.length < 20 || buffer.readUInt32LE(0) !== GLB_MAGIC) {
    throw new Error('Invalid hull GLB magic.');
  }

  const jsonLength = buffer.readUInt32LE(12);
  const jsonType = buffer.readUInt32LE(16);
  if (jsonType !== CHUNK_JSON) {
    throw new Error('Hull GLB missing JSON chunk.');
  }

  const jsonStart = 20;
  const jsonEnd = jsonStart + jsonLength;
  const json = JSON.parse(buffer.subarray(jsonStart, jsonEnd).toString('utf8')) as GlbJson;

  const binLength = buffer.readUInt32LE(jsonEnd);
  const binType = buffer.readUInt32LE(jsonEnd + 4);
  if (binType !== CHUNK_BIN) {
    throw new Error('Hull GLB missing BIN chunk.');
  }

  const bin = buffer.subarray(jsonEnd + 8, jsonEnd + 8 + binLength);
  return { json, bin };
}

async function loadHullGeometry(
  relativePath: string,
  expectedCount: number,
  topologyVersion: string,
): Promise<{ positions: Float32Array; indices: Uint32Array; topologyVersion: string }> {
  const glbPath = path.join(process.cwd(), relativePath);
  const buffer = await fs.readFile(glbPath);
  const { json, bin } = readGlbJsonAndBin(buffer);
  const primitive = json.meshes[0]?.primitives[0];
  if (!primitive) {
    throw new Error(`${relativePath} has no mesh primitive.`);
  }

  const positions = readAccessorFloat32(json, bin, primitive.attributes.POSITION, expectedCount);
  const indices = readAccessorUint32(json, bin, primitive.indices);
  return { positions, indices, topologyVersion };
}

function readAccessorFloat32(
  json: GlbJson,
  bin: Buffer,
  accessorIndex: number,
  expectedCount: number,
): Float32Array {
  const accessor = json.accessors[accessorIndex];
  const view = json.bufferViews[accessor.bufferView];
  if (!accessor || !view || accessor.type !== 'VEC3' || accessor.componentType !== 5126) {
    throw new Error('Hull POSITION accessor is invalid.');
  }

  if (accessor.count !== expectedCount) {
    throw new Error(
      `Hull vertex count ${accessor.count} does not match ${expectedCount}.`,
    );
  }

  const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const copy = new Float32Array(expectedCount * 3);
  copy.set(new Float32Array(bin.buffer, bin.byteOffset + offset, expectedCount * 3));
  return copy;
}

function readAccessorUint32(
  json: GlbJson,
  bin: Buffer,
  accessorIndex: number,
): Uint32Array {
  const accessor = json.accessors[accessorIndex];
  const view = json.bufferViews[accessor.bufferView];
  if (!accessor || !view || accessor.type !== 'SCALAR' || accessor.componentType !== 5125) {
    throw new Error('Hull INDEX accessor is invalid.');
  }

  const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const copy = new Uint32Array(accessor.count);
  copy.set(new Uint32Array(bin.buffer, bin.byteOffset + offset, accessor.count));
  return copy;
}

export async function loadAnnyHullGeometry(): Promise<AnnyHullGeometry> {
  if (cachedHull) {
    return {
      positions: cachedHull.positions.slice(),
      indices: cachedHull.indices.slice(),
      topologyVersion: cachedHull.topologyVersion,
    };
  }

  const loaded = await loadHullGeometry(
    path.join('public', 'models', 'anny-hull.glb'),
    ANNY_VERTEX_COUNT,
    ANNY_TOPOLOGY_VERSION,
  );
  cachedHull = {
    positions: loaded.positions,
    indices: loaded.indices,
    topologyVersion: ANNY_TOPOLOGY_VERSION,
  };

  return {
    positions: loaded.positions.slice(),
    indices: loaded.indices.slice(),
    topologyVersion: ANNY_TOPOLOGY_VERSION,
  };
}

export async function loadMhrHullGeometry(): Promise<MhrHullGeometry> {
  if (cachedMhrHull) {
    return {
      positions: cachedMhrHull.positions.slice(),
      indices: cachedMhrHull.indices.slice(),
      topologyVersion: cachedMhrHull.topologyVersion,
    };
  }

  const loaded = await loadHullGeometry(
    path.join('public', 'models', 'mhr-hull.glb'),
    MHR_VERTEX_COUNT,
    MHR_TOPOLOGY_VERSION,
  );
  cachedMhrHull = {
    positions: loaded.positions,
    indices: loaded.indices,
    topologyVersion: MHR_TOPOLOGY_VERSION,
  };

  return {
    positions: loaded.positions.slice(),
    indices: loaded.indices.slice(),
    topologyVersion: MHR_TOPOLOGY_VERSION,
  };
}

/**
 * Reads the shipped GLB stamp without loading vertex buffers. Phase 6 keeps
 * `anny-13380-104` unless a later licensed hull is dropped in its place.
 */
function readHullStampFromJson(json: GlbJson): Omit<ShippedAnnyHullStamp, 'matchesShippedTopology'> {
  const positionIndex = json.meshes[0]?.primitives[0]?.attributes.POSITION;
  const vertexCount =
    positionIndex === undefined ? 0 : (json.accessors[positionIndex]?.count ?? 0);
  const extras = json.extras;
  const topologyVersion =
    extras && typeof extras.topology_version === 'string' ? extras.topology_version : '';
  const stampedJointCount =
    extras && typeof extras.joint_count === 'number' && Number.isFinite(extras.joint_count)
      ? extras.joint_count
      : null;
  const embeddedJointCount = json.skins?.[0]?.joints?.length ?? 0;
  const generator =
    json.asset && typeof json.asset.generator === 'string' ? json.asset.generator : null;

  return {
    topologyVersion,
    vertexCount,
    stampedJointCount,
    embeddedJointCount,
    generator,
  };
}

export async function readShippedAnnyHullStamp(): Promise<ShippedAnnyHullStamp> {
  const glbPath = path.join(process.cwd(), 'public', 'models', 'anny-hull.glb');
  const buffer = await fs.readFile(glbPath);
  const { json } = readGlbJsonAndBin(buffer);
  const stamp = readHullStampFromJson(json);

  return {
    ...stamp,
    matchesShippedTopology:
      stamp.topologyVersion === ANNY_TOPOLOGY_VERSION
      && stamp.vertexCount === ANNY_VERTEX_COUNT
      && (stamp.stampedJointCount === null || stamp.stampedJointCount === ANNY_JOINT_COUNT),
  };
}

export async function readShippedMhrHullStamp(): Promise<ShippedAnnyHullStamp> {
  const glbPath = path.join(process.cwd(), 'public', 'models', 'mhr-hull.glb');
  const buffer = await fs.readFile(glbPath);
  const { json } = readGlbJsonAndBin(buffer);
  const stamp = readHullStampFromJson(json);

  return {
    ...stamp,
    matchesShippedTopology:
      stamp.topologyVersion === MHR_TOPOLOGY_VERSION
      && stamp.vertexCount === MHR_VERTEX_COUNT
      && (stamp.stampedJointCount === null || stamp.stampedJointCount === MHR_JOINT_COUNT),
  };
}

/**
 * Applies the same one-shot height deformation as the client renderer.
 * The shipped hull currently has no morph targets or skin, so inventing a
 * phenotype deformation here would make server collision diverge from the
 * visible client hull.
 */
export function deformHullForParametric(
  restPositions: Float32Array,
  vector: AnnyParametricVector,
  heightCm: number,
): Float32Array {
  if (vector.topology_version !== ANNY_TOPOLOGY_VERSION) {
    throw new Error(
      `ANNY topology ${vector.topology_version} does not match shipped hull ${ANNY_TOPOLOGY_VERSION}`,
    );
  }

  if (vector.phenotype.length !== ANNY_PHENOTYPE_DIM) {
    throw new Error('Phenotype must be length 6.');
  }

  const targetHeight = heightCm / 100;
  const scale = targetHeight / ANNY_HULL_REST_HEIGHT_M;

  const deformed = new Float32Array(restPositions.length);
  for (let index = 0; index < restPositions.length; index += 3) {
    deformed[index] = restPositions[index] * scale;
    deformed[index + 1] = restPositions[index + 1] * scale;
    deformed[index + 2] = restPositions[index + 2] * scale;
  }

  return deformed;
}

export function buildHullCollisionField(
  positions: Float32Array,
  measurements?: AnnyDerivedMeasurements,
  binCount = 64,
): HullCollisionField {
  const vertexCount = positions.length / 3;
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < vertexCount; index += 1) {
    const y = positions[index * 3 + 1];
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
  }

  const height = Math.max(yMax - yMin, 1e-4);
  const radii: number[][] = Array.from({ length: binCount }, () => []);
  const maxTorsoRadius =
    measurements === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(
        measurements.chest_cm,
        measurements.waist_cm,
        measurements.hip_cm,
      ) / 400 * 1.08;

  for (let index = 0; index < vertexCount; index += 1) {
    const base = index * 3;
    const x = positions[base];
    const y = positions[base + 1];
    const z = positions[base + 2];
    const t = (y - yMin) / height;
    const bin = Math.min(binCount - 1, Math.floor(t * binCount));
    const sampleRadius = Math.hypot(x, z);
    if (sampleRadius <= maxTorsoRadius) {
      radii[bin].push(sampleRadius);
    }
  }

  const radius = new Float32Array(binCount);
  let last = 0.12;
  for (let bin = 0; bin < binCount; bin += 1) {
    const samples = radii[bin];
    if (samples.length > 0) {
      samples.sort((left, right) => left - right);
      // The upper torso bins include arms. A robust 65th percentile follows
      // the rigid torso surface without inflating the collision body to arm span.
      last = samples[Math.floor((samples.length - 1) * 0.65)];
    }
    radius[bin] = last;
  }

  for (let bin = binCount - 2; bin >= 0; bin -= 1) {
    if (radii[bin].length === 0) {
      radius[bin] = radius[bin + 1];
    }
  }

  return { yMin, yMax, binCount, radius };
}

export function sampleHullRadius(field: HullCollisionField, y: number): number {
  const t = (y - field.yMin) / Math.max(field.yMax - field.yMin, 1e-4);
  const clamped = Math.min(1, Math.max(0, t));
  const exact = clamped * (field.binCount - 1);
  const lower = Math.floor(exact);
  const upper = Math.min(field.binCount - 1, lower + 1);
  const frac = exact - lower;
  return field.radius[lower] * (1 - frac) + field.radius[upper] * frac;
}
