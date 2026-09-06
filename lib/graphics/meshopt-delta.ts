/**
 * Compact binary garment delta codec for simulation_cache / garment-simulations.
 * Layout (little-endian):
 *   magic "ASIM" (4) | version u16 | flags u16 | topology hash u32
 *   vertexCount u32 | indexCount u32 | meanStrain f32
 *   restPositions f32[vertexCount*3]
 *   deltaPositions f32[vertexCount*3]
 *   strains f32[vertexCount]
 *   clearancesCm f32[vertexCount]   (v2+)
 *   indices u32[indexCount]
 *
 * "meshopt" here means a tightly packed, GPU-ready delta blob suitable for
 * V_final = V_0 + ΔX compositing — not the external meshoptimizer npm package.
 *
 * v2 added the clearance channel. v1 blobs carry no clearance and therefore
 * cannot be coloured for fit, so they are rejected rather than rendered with a
 * fabricated channel; callers re-simulate instead.
 */

import { ANNY_TOPOLOGY_VERSION, MHR_TOPOLOGY_VERSION } from '@/types/hmr';
import type { SimDrapeMesh } from '@/types/graphics';

export const SIM_DELTA_MAGIC = 0x4d495341; // 'ASIM' LE
export const SIM_DELTA_VERSION = 2;
export const SIM_DELTA_SCHEMA = 'ashrium.sim_delta.v2' as const;

const HEADER_BYTES = 4 + 2 + 2 + 4 + 4 + 4 + 4;

/** Byte offsets of the fixed-size header fields. */
const VERSION_OFFSET = 4;
const TOPOLOGY_HASH_OFFSET = 8;

function topologyHash(topologyVersion: string): number {
  let hash = 2166136261;
  for (let index = 0; index < topologyVersion.length; index += 1) {
    hash ^= topologyVersion.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const KNOWN_TOPOLOGY_HASHES: ReadonlyArray<readonly [number, string]> = [
  [topologyHash(MHR_TOPOLOGY_VERSION), MHR_TOPOLOGY_VERSION],
  [topologyHash(ANNY_TOPOLOGY_VERSION), ANNY_TOPOLOGY_VERSION],
];

function topologyVersionFromHash(hash: number): string {
  const match = KNOWN_TOPOLOGY_HASHES.find(([value]) => value === hash);
  if (!match) {
    throw new Error('Sim delta topology hash does not match a shipped hull.');
  }
  return match[1];
}

export function encodeSimDelta(mesh: SimDrapeMesh): Uint8Array {
  if (
    mesh.restPositions.length !== mesh.vertexCount * 3
    || mesh.delta.length !== mesh.vertexCount * 3
    || mesh.strain.length !== mesh.vertexCount
    || mesh.clearanceCm.length !== mesh.vertexCount
  ) {
    throw new Error('Sim delta vertex arrays do not match vertexCount.');
  }

  if (mesh.indices.length % 3 !== 0) {
    throw new Error('Sim delta indices must be triangle faces.');
  }

  const byteLength =
    HEADER_BYTES
    + mesh.restPositions.byteLength
    + mesh.delta.byteLength
    + mesh.strain.byteLength
    + mesh.clearanceCm.byteLength
    + mesh.indices.byteLength;
  const buffer = new ArrayBuffer(byteLength);
  const view = new DataView(buffer);
  let offset = 0;

  view.setUint32(offset, SIM_DELTA_MAGIC, true);
  offset += 4;
  view.setUint16(offset, SIM_DELTA_VERSION, true);
  offset += 2;
  view.setUint16(offset, 0, true);
  offset += 2;
  view.setUint32(offset, topologyHash(mesh.topologyVersion), true);
  offset += 4;
  view.setUint32(offset, mesh.vertexCount, true);
  offset += 4;
  view.setUint32(offset, mesh.indices.length, true);
  offset += 4;
  view.setFloat32(offset, mesh.meanStrain, true);
  offset += 4;

  const bytes = new Uint8Array(buffer);
  bytes.set(new Uint8Array(mesh.restPositions.buffer, mesh.restPositions.byteOffset, mesh.restPositions.byteLength), offset);
  offset += mesh.restPositions.byteLength;
  bytes.set(new Uint8Array(mesh.delta.buffer, mesh.delta.byteOffset, mesh.delta.byteLength), offset);
  offset += mesh.delta.byteLength;
  bytes.set(new Uint8Array(mesh.strain.buffer, mesh.strain.byteOffset, mesh.strain.byteLength), offset);
  offset += mesh.strain.byteLength;
  bytes.set(
    new Uint8Array(mesh.clearanceCm.buffer, mesh.clearanceCm.byteOffset, mesh.clearanceCm.byteLength),
    offset,
  );
  offset += mesh.clearanceCm.byteLength;
  bytes.set(new Uint8Array(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength), offset);

  return bytes;
}

export function decodeSimDelta(bytes: Uint8Array): SimDrapeMesh {
  if (bytes.byteLength < HEADER_BYTES) {
    throw new Error('Sim delta blob is too short.');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const magic = view.getUint32(offset, true);
  offset += 4;
  if (magic !== SIM_DELTA_MAGIC) {
    throw new Error('Sim delta magic mismatch.');
  }

  const version = view.getUint16(offset, true);
  offset += 2;
  if (version !== SIM_DELTA_VERSION) {
    throw new Error(`Unsupported sim delta version ${version}.`);
  }

  offset += 2; // flags
  const expectedHash = view.getUint32(offset, true);
  offset += 4;
  const topologyVersion = topologyVersionFromHash(expectedHash);

  const vertexCount = view.getUint32(offset, true);
  offset += 4;
  const indexCount = view.getUint32(offset, true);
  offset += 4;
  const meanStrain = view.getFloat32(offset, true);
  offset += 4;

  const restBytes = vertexCount * 3 * 4;
  const deltaBytes = vertexCount * 3 * 4;
  const strainBytes = vertexCount * 4;
  const clearanceBytes = vertexCount * 4;
  const indexBytes = indexCount * 4;
  const expected =
    HEADER_BYTES + restBytes + deltaBytes + strainBytes + clearanceBytes + indexBytes;
  if (bytes.byteLength < expected) {
    throw new Error('Sim delta blob truncated.');
  }

  const restPositions = new Float32Array(vertexCount * 3);
  const delta = new Float32Array(vertexCount * 3);
  const strain = new Float32Array(vertexCount);
  const clearanceCm = new Float32Array(vertexCount);
  const indices = new Uint32Array(indexCount);

  restPositions.set(new Float32Array(bytes.buffer, bytes.byteOffset + offset, vertexCount * 3));
  offset += restBytes;
  delta.set(new Float32Array(bytes.buffer, bytes.byteOffset + offset, vertexCount * 3));
  offset += deltaBytes;
  strain.set(new Float32Array(bytes.buffer, bytes.byteOffset + offset, vertexCount));
  offset += strainBytes;
  clearanceCm.set(new Float32Array(bytes.buffer, bytes.byteOffset + offset, vertexCount));
  offset += clearanceBytes;
  indices.set(new Uint32Array(bytes.buffer, bytes.byteOffset + offset, indexCount));

  return {
    restPositions,
    delta,
    strain,
    clearanceCm,
    indices,
    vertexCount,
    topologyVersion,
    meanStrain,
  };
}

/**
 * Header-only version probe. Lets a server read a cached blob's schema version
 * without allocating the full vertex arrays, so stale rows can fall through to a
 * fresh simulation instead of shipping an undecodable payload to the client.
 */
export function isCurrentSimDelta(bytes: Uint8Array, topologyVersion?: string): boolean {
  if (bytes.byteLength < HEADER_BYTES) {
    return false;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0, true) !== SIM_DELTA_MAGIC
    || view.getUint16(VERSION_OFFSET, true) !== SIM_DELTA_VERSION
  ) {
    return false;
  }

  const hash = view.getUint32(TOPOLOGY_HASH_OFFSET, true);
  if (topologyVersion) {
    return hash === topologyHash(topologyVersion);
  }

  return KNOWN_TOPOLOGY_HASHES.some(([value]) => value === hash);
}

export function simDeltaToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

export function simDeltaFromBase64(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Apply meshopt delta: V_final = V_0 + ΔX. */
export function compositeSimPositions(mesh: SimDrapeMesh): Float32Array {
  const positions = new Float32Array(mesh.vertexCount * 3);
  for (let index = 0; index < positions.length; index += 1) {
    positions[index] = mesh.restPositions[index] + mesh.delta[index];
  }
  return positions;
}
