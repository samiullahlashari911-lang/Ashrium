import { sampleHullRadius } from '@/lib/graphics/anny-hull-server';
import { computeVertexStrains } from '@/lib/graphics/strain-heatmap';
import type { GarmentMechanicalProperties, RestLengthMesh } from '@/types/garment';
import type { HullCollisionField, SimDrapeMesh } from '@/types/graphics';
import { ANNY_TOPOLOGY_VERSION } from '@/types/hmr';

export interface XpbdRunInput {
  restMesh: RestLengthMesh;
  mechanical: GarmentMechanicalProperties;
  body: HullCollisionField;
  /** Vertical placement of the garment on the hull (meters). */
  originY: number;
}

export interface XpbdRunResult {
  mesh: SimDrapeMesh;
  durationMs: number;
}

const SUBSTEPS = 60;
const DT = 1 / 90;
const ITERATIONS = 6;
const FABRIC_GAP_M = 0.004;
const GRAVITY = 9.81;
const DAMPING = 0.94;

interface XpbdDistanceConstraint {
  a: number;
  b: number;
  restLength: number;
  compliance: number;
  lambda: number;
}

interface XpbdClothState {
  positions: Float32Array;
  previous: Float32Array;
  restPositions: Float32Array;
  inverseMasses: Float32Array;
  structural: XpbdDistanceConstraint[];
  shear: XpbdDistanceConstraint[];
  bending: XpbdDistanceConstraint[];
  faceIndices: Uint32Array;
}

function distance(positions: Float32Array, a: number, b: number): number {
  const aBase = a * 3;
  const bBase = b * 3;
  return Math.hypot(
    positions[bBase] - positions[aBase],
    positions[bBase + 1] - positions[aBase + 1],
    positions[bBase + 2] - positions[aBase + 2],
  );
}

function complianceFromStiffness(stiffness: number): number {
  return 1 / Math.max(stiffness, 1e-4);
}

function bendingCompliance(rigidity: number): number {
  return 1 / Math.max(rigidity * 5_000, 1e-4);
}

function buildClothState(
  restMesh: RestLengthMesh,
  mechanical: GarmentMechanicalProperties,
  originY: number,
): XpbdClothState {
  const segmentsPerQuarter = restMesh.cols - 1;
  const ringColumns = segmentsPerQuarter * 4;
  const vertexCount = restMesh.rows * ringColumns;
  const positions = new Float32Array(vertexCount * 3);
  const previous = new Float32Array(vertexCount * 3);
  const restPositions = new Float32Array(vertexCount * 3);
  const inverseMasses = new Float32Array(vertexCount);

  const garmentAreaM2 =
    (restMesh.measurements.lengthCm / 100)
    * (restMesh.measurements.chestCm / 100);
  const vertexMass = Math.max(
    (mechanical.areaDensity * garmentAreaM2) / vertexCount,
    1e-5,
  );
  const inverseMass = 1 / vertexMass;

  for (let row = 0; row < restMesh.rows; row += 1) {
    const sourceRowStart = row * restMesh.cols;
    let quarterCircumference = 0;
    for (let sourceCol = 0; sourceCol < restMesh.cols; sourceCol += 1) {
      quarterCircumference = Math.max(
        quarterCircumference,
        restMesh.vertices[(sourceRowStart + sourceCol) * 2],
      );
    }

    const radius = Math.max((quarterCircumference * 2) / Math.PI, 0.02);
    const sourceY = restMesh.vertices[sourceRowStart * 2 + 1];

    for (let col = 0; col < ringColumns; col += 1) {
      const index = row * ringColumns + col;
      const angle = (col / ringColumns) * Math.PI * 2;
      const y = originY + sourceY;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const base = index * 3;
      positions[base] = x;
      positions[base + 1] = y;
      positions[base + 2] = z;
      restPositions[base] = x;
      restPositions[base + 1] = y;
      restPositions[base + 2] = z;
      previous[base] = x;
      previous[base + 1] = y;
      previous[base + 2] = z;
      inverseMasses[index] = row === restMesh.rows - 1 ? 0 : inverseMass;
    }
  }

  const structural: XpbdDistanceConstraint[] = [];
  const shear: XpbdDistanceConstraint[] = [];
  const bending: XpbdDistanceConstraint[] = [];
  const addConstraint = (
    target: XpbdDistanceConstraint[],
    a: number,
    b: number,
    compliance: number,
  ): void => {
    target.push({
      a,
      b,
      restLength: distance(restPositions, a, b),
      compliance,
      lambda: 0,
    });
  };

  const stretchCompliance = complianceFromStiffness(mechanical.tensileStiffness);
  const shearCompliance = complianceFromStiffness(mechanical.shearStiffness);
  const bendCompliance = bendingCompliance(mechanical.bendingRigidity);

  for (let row = 0; row < restMesh.rows; row += 1) {
    for (let col = 0; col < ringColumns; col += 1) {
      const current = row * ringColumns + col;
      const nextCol = row * ringColumns + ((col + 1) % ringColumns);
      addConstraint(structural, current, nextCol, stretchCompliance);

      if (row + 1 < restMesh.rows) {
        const nextRow = current + ringColumns;
        const nextRowCol = nextCol + ringColumns;
        addConstraint(structural, current, nextRow, stretchCompliance);
        addConstraint(shear, current, nextRowCol, shearCompliance);
        addConstraint(shear, nextCol, nextRow, shearCompliance);
      }

      if (row + 2 < restMesh.rows) {
        addConstraint(bending, current, current + ringColumns * 2, bendCompliance);
      }

      addConstraint(
        bending,
        current,
        row * ringColumns + ((col + 2) % ringColumns),
        bendCompliance,
      );
    }
  }

  const faces: number[] = [];
  for (let row = 0; row < restMesh.rows - 1; row += 1) {
    for (let col = 0; col < ringColumns; col += 1) {
      const a = row * ringColumns + col;
      const b = row * ringColumns + ((col + 1) % ringColumns);
      const c = a + ringColumns;
      const d = b + ringColumns;
      faces.push(a, c, b, b, c, d);
    }
  }

  return {
    positions,
    previous,
    restPositions,
    inverseMasses,
    structural,
    shear,
    bending,
    faceIndices: new Uint32Array(faces),
  };
}

function resetLambdas(constraints: XpbdDistanceConstraint[]): void {
  for (const constraint of constraints) {
    constraint.lambda = 0;
  }
}

function solveDistanceConstraint(
  positions: Float32Array,
  inverseMasses: Float32Array,
  constraint: XpbdDistanceConstraint,
): void {
  const { a, b, restLength, compliance } = constraint;
  const invA = inverseMasses[a];
  const invB = inverseMasses[b];
  const invSum = invA + invB;
  if (invSum <= 0 || restLength <= 1e-8) {
    return;
  }

  const ax = positions[a * 3];
  const ay = positions[a * 3 + 1];
  const az = positions[a * 3 + 2];
  const bx = positions[b * 3];
  const by = positions[b * 3 + 1];
  const bz = positions[b * 3 + 2];
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const length = Math.hypot(dx, dy, dz);
  if (length <= 1e-8) {
    return;
  }

  const constraintValue = length - restLength;
  const alphaTilde = compliance / (DT * DT);
  const deltaLambda =
    (-constraintValue - alphaTilde * constraint.lambda) / (invSum + alphaTilde);
  constraint.lambda += deltaLambda;
  const nx = dx / length;
  const ny = dy / length;
  const nz = dz / length;

  if (invA > 0) {
    positions[a * 3] -= nx * deltaLambda * invA;
    positions[a * 3 + 1] -= ny * deltaLambda * invA;
    positions[a * 3 + 2] -= nz * deltaLambda * invA;
  }

  if (invB > 0) {
    positions[b * 3] += nx * deltaLambda * invB;
    positions[b * 3 + 1] += ny * deltaLambda * invB;
    positions[b * 3 + 2] += nz * deltaLambda * invB;
  }
}

function collideWithHull(
  positions: Float32Array,
  inverseMasses: Float32Array,
  body: HullCollisionField,
): void {
  const vertexCount = inverseMasses.length;
  for (let index = 0; index < vertexCount; index += 1) {
    if (inverseMasses[index] === 0) {
      continue;
    }

    const base = index * 3;
    const x = positions[base];
    const y = positions[base + 1];
    const z = positions[base + 2];
    const radius = sampleHullRadius(body, y) + FABRIC_GAP_M;
    const horizontal = Math.hypot(x, z);
    if (horizontal >= radius || horizontal <= 1e-8) {
      if (horizontal <= 1e-8) {
        positions[base] = radius;
        positions[base + 2] = 0;
      }
      continue;
    }

    const scale = radius / horizontal;
    positions[base] = x * scale;
    positions[base + 2] = z * scale;
  }
}

/**
 * Radial garment-to-body clearance per vertex, in centimetres.
 *
 * Uses the same Y-binned hull radii as `collideWithHull`, so a vertex resting on
 * the body reports exactly `FABRIC_GAP_M` of clearance rather than a value that
 * disagrees with the collision constraint that produced it.
 */
function computeClearancesCm(
  positions: Float32Array,
  body: HullCollisionField,
  vertexCount: number,
): Float32Array {
  const clearances = new Float32Array(vertexCount);

  for (let index = 0; index < vertexCount; index += 1) {
    const base = index * 3;
    const horizontal = Math.hypot(positions[base], positions[base + 2]);
    const bodyRadius = sampleHullRadius(body, positions[base + 1]);
    clearances[index] = (horizontal - bodyRadius) * 100;
  }

  return clearances;
}

/**
 * Server-side XPBD on a rest-length panel wrapped around the rigid ANNY hull.
 * First-miss latency target: 2.5–6s on a cold serverless route.
 */
export function runXpbdOnHull(input: XpbdRunInput): XpbdRunResult {
  const started = Date.now();
  const cloth = buildClothState(input.restMesh, input.mechanical, input.originY);

  for (let step = 0; step < SUBSTEPS; step += 1) {
    resetLambdas(cloth.structural);
    resetLambdas(cloth.shear);
    resetLambdas(cloth.bending);

    const vertexCount = cloth.inverseMasses.length;
    for (let index = 0; index < vertexCount; index += 1) {
      if (cloth.inverseMasses[index] === 0) {
        continue;
      }

      const base = index * 3;
      const x = cloth.positions[base];
      const y = cloth.positions[base + 1];
      const z = cloth.positions[base + 2];
      const px = cloth.previous[base];
      const py = cloth.previous[base + 1];
      const pz = cloth.previous[base + 2];
      const vx = (x - px) * DAMPING;
      const vy = (y - py) * DAMPING - GRAVITY * DT * DT;
      const vz = (z - pz) * DAMPING;
      cloth.previous[base] = x;
      cloth.previous[base + 1] = y;
      cloth.previous[base + 2] = z;
      cloth.positions[base] = x + vx;
      cloth.positions[base + 1] = y + vy;
      cloth.positions[base + 2] = z + vz;
    }

    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      for (const constraint of cloth.structural) {
        solveDistanceConstraint(cloth.positions, cloth.inverseMasses, constraint);
      }

      for (const constraint of cloth.shear) {
        solveDistanceConstraint(cloth.positions, cloth.inverseMasses, constraint);
      }

      for (const constraint of cloth.bending) {
        solveDistanceConstraint(cloth.positions, cloth.inverseMasses, constraint);
      }

      collideWithHull(cloth.positions, cloth.inverseMasses, input.body);
    }
  }

  const delta = new Float32Array(cloth.positions.length);
  for (let index = 0; index < delta.length; index += 1) {
    delta[index] = cloth.positions[index] - cloth.restPositions[index];
  }

  const strain = computeVertexStrains(cloth.restPositions, cloth.positions, cloth.faceIndices);
  let meanStrain = 0;
  for (let index = 0; index < strain.length; index += 1) {
    meanStrain += Math.abs(strain[index]);
  }
  meanStrain = strain.length > 0 ? meanStrain / strain.length : 0;

  const vertexCount = cloth.inverseMasses.length;

  return {
    durationMs: Date.now() - started,
    mesh: {
      restPositions: cloth.restPositions,
      delta,
      strain,
      clearanceCm: computeClearancesCm(cloth.positions, input.body, vertexCount),
      indices: cloth.faceIndices,
      vertexCount,
      topologyVersion: ANNY_TOPOLOGY_VERSION,
      meanStrain,
    },
  };
}

export function garmentOriginY(
  body: HullCollisionField,
  category: RestLengthMesh['category'],
): number {
  const span = body.yMax - body.yMin;
  if (category === 'pant') {
    return body.yMin + span * 0.08;
  }

  if (category === 'dress') {
    return body.yMin + span * 0.18;
  }

  return body.yMin + span * 0.48;
}
