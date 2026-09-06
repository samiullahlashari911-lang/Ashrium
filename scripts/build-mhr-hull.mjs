/**
 * One-shot export: official Meta MHR LOD 1 rest-pose (Apache 2.0) → public/models/mhr-hull.glb.
 * Reads tmp/assets/lod1.fbx from the v1.0.1 assets.zip release. Does not add npm deps.
 */
import { inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MHR_VERTEX_COUNT = 18439;
const MHR_JOINT_COUNT = 127;
const MHR_TOPOLOGY_VERSION = 'mhr-18439-127';

const FBX_MAGIC = Buffer.from('Kaydara FBX Binary  \u0000');
const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fbxPath = process.argv[2] ?? join(repoRoot, 'tmp', 'assets', 'lod1.fbx');
const outPath = process.argv[3] ?? join(repoRoot, 'public', 'models', 'mhr-hull.glb');

function readNodeHeader(buffer, offset, wide) {
  if (wide) {
    return {
      endOffset: Number(buffer.readBigUInt64LE(offset)),
      numProperties: Number(buffer.readBigUInt64LE(offset + 8)),
      propertyListLen: Number(buffer.readBigUInt64LE(offset + 16)),
      headerSize: 24,
    };
  }

  return {
    endOffset: buffer.readUInt32LE(offset),
    numProperties: buffer.readUInt32LE(offset + 4),
    propertyListLen: buffer.readUInt32LE(offset + 8),
    headerSize: 12,
  };
}

function readProperty(buffer, offset) {
  const type = String.fromCharCode(buffer[offset]);
  let cursor = offset + 1;

  const readArray = (bytesPerElement, reader) => {
    const length = buffer.readUInt32LE(cursor);
    const encoding = buffer.readUInt32LE(cursor + 4);
    const compressedLen = buffer.readUInt32LE(cursor + 8);
    cursor += 12;
    let payload;
    if (encoding === 1) {
      payload = inflateSync(buffer.subarray(cursor, cursor + compressedLen));
      cursor += compressedLen;
    } else {
      const rawLen = length * bytesPerElement;
      payload = buffer.subarray(cursor, cursor + rawLen);
      cursor += rawLen;
    }

    const values = [];
    for (let index = 0; index < length; index += 1) {
      values.push(reader(payload, index * bytesPerElement));
    }

    return { value: values, next: cursor };
  };

  switch (type) {
    case 'Y':
      return { value: buffer.readInt16LE(cursor), next: cursor + 2 };
    case 'C':
      return { value: buffer[cursor], next: cursor + 1 };
    case 'I':
      return { value: buffer.readInt32LE(cursor), next: cursor + 4 };
    case 'F':
      return { value: buffer.readFloatLE(cursor), next: cursor + 4 };
    case 'D':
      return { value: buffer.readDoubleLE(cursor), next: cursor + 8 };
    case 'L':
      return { value: buffer.readBigInt64LE(cursor), next: cursor + 8 };
    case 'f':
      return readArray(4, (payload, at) => payload.readFloatLE(at));
    case 'd':
      return readArray(8, (payload, at) => payload.readDoubleLE(at));
    case 'l':
      return readArray(8, (payload, at) => payload.readBigInt64LE(at));
    case 'i':
      return readArray(4, (payload, at) => payload.readInt32LE(at));
    case 'b':
      return readArray(1, (payload, at) => payload[at]);
    case 'S':
    case 'R': {
      const length = buffer.readUInt32LE(cursor);
      cursor += 4;
      const value = buffer.subarray(cursor, cursor + length);
      return { value: type === 'S' ? value.toString('utf8') : value, next: cursor + length };
    }
    default:
      throw new Error(`Unsupported FBX property type ${type}`);
  }
}

function parseNode(buffer, offset, wide) {
  const header = readNodeHeader(buffer, offset, wide);
  if (header.endOffset === 0) {
    return { node: null, next: offset + header.headerSize + 1 };
  }

  const nameLength = buffer[offset + header.headerSize];
  const nameStart = offset + header.headerSize + 1;
  const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8');
  let cursor = nameStart + nameLength;
  const properties = [];
  for (let index = 0; index < header.numProperties; index += 1) {
    const property = readProperty(buffer, cursor);
    properties.push(property.value);
    cursor = property.next;
  }

  const children = [];
  while (cursor < header.endOffset) {
    const child = parseNode(buffer, cursor, wide);
    if (!child.node) {
      cursor = child.next;
      break;
    }
    children.push(child.node);
    cursor = child.next;
  }

  return {
    node: { name, properties, children },
    next: header.endOffset,
  };
}

function walk(node, visit) {
  visit(node);
  for (const child of node.children) {
    walk(child, visit);
  }
}

function triangulate(polygonIndices) {
  const triangles = [];
  let start = 0;
  for (let index = 0; index < polygonIndices.length; index += 1) {
    const raw = polygonIndices[index];
    if (raw >= 0) {
      continue;
    }

    const polygon = polygonIndices.slice(start, index).concat(~raw);
    start = index + 1;
    for (let corner = 1; corner + 1 < polygon.length; corner += 1) {
      triangles.push(polygon[0], polygon[corner], polygon[corner + 1]);
    }
  }

  return triangles;
}

function findLod1Mesh(root) {
  const meshes = [];
  walk(root, (node) => {
    if (node.name !== 'Geometry') {
      return;
    }

    let vertices = null;
    let polygons = null;
    for (const child of node.children) {
      if (child.name === 'Vertices' && Array.isArray(child.properties[0])) {
        vertices = child.properties[0];
      }
      if (child.name === 'PolygonVertexIndex' && Array.isArray(child.properties[0])) {
        polygons = child.properties[0];
      }
    }

    if (vertices && polygons && vertices.length === MHR_VERTEX_COUNT * 3) {
      meshes.push({ vertices, indices: triangulate(polygons) });
    }
  });

  if (meshes.length === 0) {
    throw new Error(`No FBX Geometry with ${MHR_VERTEX_COUNT} vertices.`);
  }

  return meshes[0];
}

function positionsToMeters(values) {
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

function padToFour(length) {
  return (4 - (length % 4)) % 4;
}

function writeGlb(positions, indices) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index < positions.length; index += 3) {
    minX = Math.min(minX, positions[index]);
    minY = Math.min(minY, positions[index + 1]);
    minZ = Math.min(minZ, positions[index + 2]);
    maxX = Math.max(maxX, positions[index]);
    maxY = Math.max(maxY, positions[index + 1]);
    maxZ = Math.max(maxZ, positions[index + 2]);
  }

  const positionBytes = Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength);
  const indexBytes = Buffer.from(
    new Uint32Array(indices).buffer,
    0,
    indices.length * 4,
  );
  const bin = Buffer.concat([positionBytes, indexBytes]);
  const json = {
    asset: {
      version: '2.0',
      generator: 'Ashrium Phase 3 MHR hull export',
    },
    extras: {
      topology_version: MHR_TOPOLOGY_VERSION,
      vertex_count: MHR_VERTEX_COUNT,
      joint_count: MHR_JOINT_COUNT,
      source: 'facebookresearch/MHR v1.0.1 assets/lod1.fbx (Apache 2.0 rest-pose LOD 1)',
    },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.length, target: 34962 },
      { buffer: 0, byteOffset: positionBytes.length, byteLength: indexBytes.length, target: 34963 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: MHR_VERTEX_COUNT,
        type: 'VEC3',
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
      },
      {
        bufferView: 1,
        componentType: 5125,
        count: indices.length,
        type: 'SCALAR',
      },
    ],
    meshes: [
      {
        name: 'mhr-lod1',
        extras: { topology_version: MHR_TOPOLOGY_VERSION },
        primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }],
      },
    ],
    nodes: [{ name: 'mhr-hull', mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };

  const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPadding = Buffer.alloc(padToFour(jsonBuffer.length), 0x20);
  const binPadding = Buffer.alloc(padToFour(bin.length), 0);
  const jsonChunk = Buffer.concat([jsonBuffer, jsonPadding]);
  const binChunk = Buffer.concat([bin, binPadding]);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(CHUNK_JSON, 4);

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.length, 0);
  binHeader.writeUInt32LE(CHUNK_BIN, 4);

  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]);
}

const fbx = readFileSync(fbxPath);
if (!fbx.subarray(0, FBX_MAGIC.length).equals(FBX_MAGIC)) {
  throw new Error('Not a binary FBX.');
}

const version = fbx.readUInt32LE(23);
const wide = version >= 7500;
const root = { name: 'Root', properties: [], children: [] };
let cursor = 27;
while (cursor < fbx.length) {
  const parsed = parseNode(fbx, cursor, wide);
  if (!parsed.node) {
    break;
  }
  root.children.push(parsed.node);
  cursor = parsed.next;
}

const mesh = findLod1Mesh(root);
const positions = positionsToMeters(mesh.vertices);
if (new Set(mesh.indices).size < MHR_VERTEX_COUNT * 0.9) {
  throw new Error('LOD 1 index set is too small for the official topology.');
}

writeFileSync(outPath, writeGlb(positions, mesh.indices));
const height = (() => {
  let minY = Infinity;
  let maxY = -Infinity;
  for (let index = 1; index < positions.length; index += 3) {
    minY = Math.min(minY, positions[index]);
    maxY = Math.max(maxY, positions[index]);
  }
  return maxY - minY;
})();

console.log(
  JSON.stringify(
    {
      outPath,
      topology: MHR_TOPOLOGY_VERSION,
      vertices: MHR_VERTEX_COUNT,
      triangles: mesh.indices.length / 3,
      restHeightM: Number(height.toFixed(5)),
      fbxVersion: version,
    },
    null,
    2,
  ),
);
