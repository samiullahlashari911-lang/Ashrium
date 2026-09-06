/*
 * OPTIONAL DEBUG PATH — not the storefront product path.
 *
 * The locked product drapes garments on the ANNY parametric hull via XPBD
 * (cache miss) or an HNSW delta lookup (cache hit). This module is a
 * client-side PBD cylinder demo used by VFRCanvas as a transitional debug
 * renderer until the Phase 1 ANNY viewport ships. Do not treat this as the
 * storefront drape pipeline.
 */
import type { PbdEnergyBreakdown, PbdMechanicalProperties } from '@/types/graphics';

export interface PbdClothConfig extends PbdMechanicalProperties {
  gravity: number;
  collisionRadius: number;
  constraintIterations: number;
  damping: number;
}

export interface PbdClothMesh {
  positions: Float32Array;
  restPositions: Float32Array;
  previousPositions: Float32Array;
  velocities: Float32Array;
  inverseMasses: Float32Array;
  edges: ReadonlyArray<readonly [number, number]>;
  bendingPairs: ReadonlyArray<readonly [number, number, number]>;
  shearPairs: ReadonlyArray<readonly [number, number, number, number]>;
}

export interface PbdClothSimulatorOptions {
  config: PbdClothConfig;
  mesh: PbdClothMesh;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const DEFAULT_CONFIG: PbdClothConfig = {
  tensileStiffness: 120.0,
  bendingRigidity: 0.02,
  shearStiffness: 80.0,
  areaDensity: 0.35,
  gravity: 9.81,
  collisionRadius: 0.34,
  constraintIterations: 6,
  damping: 0.995,
};

function readVec3(array: Float32Array, index: number): Vec3 {
  const base = index * 3;
  return {
    x: array[base],
    y: array[base + 1],
    z: array[base + 2],
  };
}

function writeVec3(array: Float32Array, index: number, vector: Vec3): void {
  const base = index * 3;
  array[base] = vector.x;
  array[base + 1] = vector.y;
  array[base + 2] = vector.z;
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(vector: Vec3, scalar: number): Vec3 {
  return { x: vector.x * scalar, y: vector.y * scalar, z: vector.z * scalar };
}

function length(vector: Vec3): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function normalize(vector: Vec3): Vec3 {
  const magnitude = length(vector);
  if (magnitude <= 1e-8) {
    return { x: 0, y: 0, z: 0 };
  }

  return scale(vector, 1 / magnitude);
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function distance(a: Vec3, b: Vec3): number {
  return length(subtract(a, b));
}

function restDistance(
  restPositions: Float32Array,
  vertexA: number,
  vertexB: number,
): number {
  return distance(readVec3(restPositions, vertexA), readVec3(restPositions, vertexB));
}

export function createGarmentClothGrid(
  widthSegments: number,
  heightSegments: number,
  width: number,
  height: number,
  originY: number,
): PbdClothMesh {
  const vertexCount = (widthSegments + 1) * (heightSegments + 1);
  const positions = new Float32Array(vertexCount * 3);
  const restPositions = new Float32Array(vertexCount * 3);
  const previousPositions = new Float32Array(vertexCount * 3);
  const velocities = new Float32Array(vertexCount * 3);
  const inverseMasses = new Float32Array(vertexCount);

  let vertexIndex = 0;
  for (let row = 0; row <= heightSegments; row += 1) {
    for (let column = 0; column <= widthSegments; column += 1) {
      const x = (column / widthSegments - 0.5) * width;
      const y = originY + (1 - row / heightSegments) * height;
      const z = 0.05;

      positions[vertexIndex * 3] = x;
      positions[vertexIndex * 3 + 1] = y;
      positions[vertexIndex * 3 + 2] = z;

      restPositions[vertexIndex * 3] = x;
      restPositions[vertexIndex * 3 + 1] = y;
      restPositions[vertexIndex * 3 + 2] = z;

      previousPositions[vertexIndex * 3] = x;
      previousPositions[vertexIndex * 3 + 1] = y;
      previousPositions[vertexIndex * 3 + 2] = z;

      const isPinned = row === 0 && (column === 0 || column === widthSegments);
      inverseMasses[vertexIndex] = isPinned ? 0 : 1;

      vertexIndex += 1;
    }
  }

  const edges: Array<[number, number]> = [];
  const bendingPairs: Array<[number, number, number]> = [];
  const shearPairs: Array<[number, number, number, number]> = [];

  const indexAt = (row: number, column: number): number => row * (widthSegments + 1) + column;

  for (let row = 0; row <= heightSegments; row += 1) {
    for (let column = 0; column <= widthSegments; column += 1) {
      const current = indexAt(row, column);

      if (column < widthSegments) {
        edges.push([current, indexAt(row, column + 1)]);
      }

      if (row < heightSegments) {
        edges.push([current, indexAt(row + 1, column)]);
      }

      if (row < heightSegments && column < widthSegments) {
        shearPairs.push([current, indexAt(row, column + 1), indexAt(row + 1, column), indexAt(row + 1, column + 1)]);
      }

      if (row < heightSegments - 1) {
        bendingPairs.push([indexAt(row, column), indexAt(row + 1, column), indexAt(row + 2, column)]);
      }
    }
  }

  return {
    positions,
    restPositions,
    previousPositions,
    velocities,
    inverseMasses,
    edges,
    bendingPairs,
    shearPairs,
  };
}

export function createClothFaceIndices(
  widthSegments: number,
  heightSegments: number,
): Uint32Array {
  const indices: number[] = [];

  for (let row = 0; row < heightSegments; row += 1) {
    for (let column = 0; column < widthSegments; column += 1) {
      const topLeft = row * (widthSegments + 1) + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + widthSegments + 1;
      const bottomRight = bottomLeft + 1;

      indices.push(topLeft, bottomLeft, topRight);
      indices.push(topRight, bottomLeft, bottomRight);
    }
  }

  return new Uint32Array(indices);
}

export class PbdClothSimulator {
  private readonly config: PbdClothConfig;

  private readonly mesh: PbdClothMesh;

  constructor(options: PbdClothSimulatorOptions) {
    this.config = options.config;
    this.mesh = options.mesh;
  }

  static withDefaults(mesh: PbdClothMesh, overrides?: Partial<PbdClothConfig>): PbdClothSimulator {
    return new PbdClothSimulator({
      mesh,
      config: { ...DEFAULT_CONFIG, ...overrides },
    });
  }

  getPositions(): Float32Array {
    return this.mesh.positions;
  }

  getRestPositions(): Float32Array {
    return this.mesh.restPositions;
  }

  step(deltaSeconds: number): void {
    this.applyExternalForces(deltaSeconds);
    this.integrate(deltaSeconds);

    for (let iteration = 0; iteration < this.config.constraintIterations; iteration += 1) {
      this.solveStretchConstraints();
      this.solveBendingConstraints();
      this.solveShearConstraints();
      this.solveCollisionConstraints();
    }

    this.updateVelocities(deltaSeconds);
  }

  computeEnergyBreakdown(): PbdEnergyBreakdown {
    const stretch = this.computeStretchEnergy();
    const bend = this.computeBendingEnergy();
    const shear = this.computeShearEnergy();
    const gravity = this.computeGravityEnergy();
    const collision = this.computeCollisionEnergy();

    return {
      stretch,
      bend,
      shear,
      gravity,
      collision,
      total: stretch + bend + shear + gravity + collision,
    };
  }

  private applyExternalForces(deltaSeconds: number): void {
    const vertexCount = this.mesh.inverseMasses.length;
    const gravityImpulse = this.config.gravity * deltaSeconds;

    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
      if (this.mesh.inverseMasses[vertexIndex] === 0) {
        continue;
      }

      const base = vertexIndex * 3 + 1;
      this.mesh.velocities[base] -= gravityImpulse;
    }
  }

  private integrate(deltaSeconds: number): void {
    const vertexCount = this.mesh.inverseMasses.length;

    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
      const inverseMass = this.mesh.inverseMasses[vertexIndex];
      if (inverseMass === 0) {
        continue;
      }

      const current = readVec3(this.mesh.positions, vertexIndex);
      const previous = readVec3(this.mesh.previousPositions, vertexIndex);
      const velocity = readVec3(this.mesh.velocities, vertexIndex);

      const next = add(add(current, scale(subtract(current, previous), this.config.damping)), scale(velocity, deltaSeconds));

      writeVec3(this.mesh.previousPositions, vertexIndex, current);
      writeVec3(this.mesh.positions, vertexIndex, next);
    }
  }

  private updateVelocities(deltaSeconds: number): void {
    if (deltaSeconds <= 0) {
      return;
    }

    const inverseDelta = 1 / deltaSeconds;
    const vertexCount = this.mesh.inverseMasses.length;

    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
      if (this.mesh.inverseMasses[vertexIndex] === 0) {
        continue;
      }

      const current = readVec3(this.mesh.positions, vertexIndex);
      const previous = readVec3(this.mesh.previousPositions, vertexIndex);
      const velocity = scale(subtract(current, previous), inverseDelta);

      writeVec3(this.mesh.velocities, vertexIndex, velocity);
    }
  }

  private solveStretchConstraints(): void {
    for (const [vertexA, vertexB] of this.mesh.edges) {
      this.applyDistanceConstraint(
        vertexA,
        vertexB,
        restDistance(this.mesh.restPositions, vertexA, vertexB),
        this.config.tensileStiffness,
      );
    }
  }

  private solveBendingConstraints(): void {
    for (const [vertexA, vertexB, vertexC] of this.mesh.bendingPairs) {
      const pointA = readVec3(this.mesh.positions, vertexA);
      const pointB = readVec3(this.mesh.positions, vertexB);
      const pointC = readVec3(this.mesh.positions, vertexC);

      const edgeBA = subtract(pointA, pointB);
      const edgeBC = subtract(pointC, pointB);
      const restBA = subtract(readVec3(this.mesh.restPositions, vertexA), readVec3(this.mesh.restPositions, vertexB));
      const restBC = subtract(readVec3(this.mesh.restPositions, vertexC), readVec3(this.mesh.restPositions, vertexB));

      const currentAngle = Math.acos(
        Math.min(1, Math.max(-1, dot(normalize(edgeBA), normalize(edgeBC)))),
      );
      const restAngle = Math.acos(
        Math.min(1, Math.max(-1, dot(normalize(restBA), normalize(restBC)))),
      );

      const angleError = currentAngle - restAngle;
      const correctionScale = angleError * this.config.bendingRigidity * 0.25;

      const correctionA = scale(normalize(edgeBA), correctionScale);
      const correctionC = scale(normalize(edgeBC), correctionScale);

      this.applyPositionDelta(vertexA, correctionA);
      this.applyPositionDelta(vertexC, correctionC);
      this.applyPositionDelta(vertexB, scale(add(correctionA, correctionC), -0.5));
    }
  }

  private solveShearConstraints(): void {
    for (const [vertexA, vertexB, vertexC, vertexD] of this.mesh.shearPairs) {
      this.applyDistanceConstraint(vertexA, vertexC, restDistance(this.mesh.restPositions, vertexA, vertexC), this.config.shearStiffness);
      this.applyDistanceConstraint(vertexB, vertexD, restDistance(this.mesh.restPositions, vertexB, vertexD), this.config.shearStiffness);
    }
  }

  private solveCollisionConstraints(): void {
    const vertexCount = this.mesh.inverseMasses.length;
    const radius = this.config.collisionRadius;

    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
      if (this.mesh.inverseMasses[vertexIndex] === 0) {
        continue;
      }

      const position = readVec3(this.mesh.positions, vertexIndex);
      const horizontalDistance = Math.hypot(position.x, position.z);

      if (horizontalDistance >= radius) {
        continue;
      }

      if (horizontalDistance <= 1e-6) {
        writeVec3(this.mesh.positions, vertexIndex, { x: radius, y: position.y, z: 0 });
        continue;
      }

      const penetration = radius - horizontalDistance;
      const normalX = position.x / horizontalDistance;
      const normalZ = position.z / horizontalDistance;

      writeVec3(this.mesh.positions, vertexIndex, {
        x: position.x + normalX * penetration,
        y: position.y,
        z: position.z + normalZ * penetration,
      });
    }
  }

  private applyDistanceConstraint(
    vertexA: number,
    vertexB: number,
    restLength: number,
    stiffness: number,
  ): void {
    const inverseMassA = this.mesh.inverseMasses[vertexA];
    const inverseMassB = this.mesh.inverseMasses[vertexB];
    const inverseMassSum = inverseMassA + inverseMassB;

    if (inverseMassSum <= 0) {
      return;
    }

    const pointA = readVec3(this.mesh.positions, vertexA);
    const pointB = readVec3(this.mesh.positions, vertexB);
    const delta = subtract(pointB, pointA);
    const currentLength = length(delta);

    if (currentLength <= 1e-8) {
      return;
    }

    const direction = scale(delta, 1 / currentLength);
    const constraintError = currentLength - restLength;
    const correctionMagnitude = (constraintError / inverseMassSum) * Math.min(1, stiffness * 0.01);
    const correction = scale(direction, correctionMagnitude);

    if (inverseMassA > 0) {
      this.applyPositionDelta(vertexA, scale(correction, inverseMassA));
    }

    if (inverseMassB > 0) {
      this.applyPositionDelta(vertexB, scale(correction, -inverseMassB));
    }
  }

  private applyPositionDelta(vertexIndex: number, delta: Vec3): void {
    if (this.mesh.inverseMasses[vertexIndex] === 0) {
      return;
    }

    const current = readVec3(this.mesh.positions, vertexIndex);
    writeVec3(this.mesh.positions, vertexIndex, add(current, delta));
  }

  private computeStretchEnergy(): number {
    let energy = 0;

    for (const [vertexA, vertexB] of this.mesh.edges) {
      const restLength = restDistance(this.mesh.restPositions, vertexA, vertexB);
      const currentLength = distance(
        readVec3(this.mesh.positions, vertexA),
        readVec3(this.mesh.positions, vertexB),
      );
      const strain = currentLength - restLength;
      energy += 0.5 * this.config.tensileStiffness * strain * strain;
    }

    return energy;
  }

  private computeBendingEnergy(): number {
    let energy = 0;

    for (const [vertexA, vertexB, vertexC] of this.mesh.bendingPairs) {
      const pointA = readVec3(this.mesh.positions, vertexA);
      const pointB = readVec3(this.mesh.positions, vertexB);
      const pointC = readVec3(this.mesh.positions, vertexC);

      const currentAngle = Math.acos(
        Math.min(1, Math.max(-1, dot(
          normalize(subtract(pointA, pointB)),
          normalize(subtract(pointC, pointB)),
        ))),
      );

      const restPointA = readVec3(this.mesh.restPositions, vertexA);
      const restPointB = readVec3(this.mesh.restPositions, vertexB);
      const restPointC = readVec3(this.mesh.restPositions, vertexC);

      const restAngle = Math.acos(
        Math.min(1, Math.max(-1, dot(
          normalize(subtract(restPointA, restPointB)),
          normalize(subtract(restPointC, restPointB)),
        ))),
      );

      const angleError = currentAngle - restAngle;
      energy += 0.5 * this.config.bendingRigidity * angleError * angleError;
    }

    return energy;
  }

  private computeShearEnergy(): number {
    let energy = 0;

    for (const [vertexA, vertexB, vertexC, vertexD] of this.mesh.shearPairs) {
      const restShearAC = restDistance(this.mesh.restPositions, vertexA, vertexC);
      const restShearBD = restDistance(this.mesh.restPositions, vertexB, vertexD);
      const currentShearAC = distance(readVec3(this.mesh.positions, vertexA), readVec3(this.mesh.positions, vertexC));
      const currentShearBD = distance(readVec3(this.mesh.positions, vertexB), readVec3(this.mesh.positions, vertexD));

      const shearErrorAC = currentShearAC - restShearAC;
      const shearErrorBD = currentShearBD - restShearBD;

      energy += 0.5 * this.config.shearStiffness * shearErrorAC * shearErrorAC;
      energy += 0.5 * this.config.shearStiffness * shearErrorBD * shearErrorBD;
    }

    return energy;
  }

  private computeGravityEnergy(): number {
    let energy = 0;
    const vertexCount = this.mesh.inverseMasses.length;

    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
      const inverseMass = this.mesh.inverseMasses[vertexIndex];
      if (inverseMass === 0) {
        continue;
      }

      const mass = 1 / inverseMass;
      const positionY = this.mesh.positions[vertexIndex * 3 + 1];
      energy += mass * this.config.gravity * positionY;
    }

    return energy;
  }

  private computeCollisionEnergy(): number {
    let energy = 0;
    const radius = this.config.collisionRadius;
    const vertexCount = this.mesh.inverseMasses.length;

    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
      const position = readVec3(this.mesh.positions, vertexIndex);
      const horizontalDistance = Math.hypot(position.x, position.z);
      const penetration = radius - horizontalDistance;

      if (penetration > 0) {
        energy += 0.5 * penetration * penetration * this.config.areaDensity * 1000;
      }
    }

    return energy;
  }
}
