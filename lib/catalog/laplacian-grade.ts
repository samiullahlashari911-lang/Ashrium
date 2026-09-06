import { REST_LENGTH_SCHEMA, type GarmentCategory, type RestLengthMesh } from '@/types/garment';

const GRID_ROWS = 9;
const GRID_COLS = 7;

export interface PatternMeasurements {
  chestCm: number;
  waistCm: number;
  hipCm: number;
  lengthCm: number;
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function vertexIndex(row: number, col: number): number {
  return row * GRID_COLS + col;
}

function girthCmAt(t: number, category: GarmentCategory, measurements: PatternMeasurements): number {
  if (category === 'pant') {
    if (t < 0.35) {
      return lerp(measurements.hipCm * 0.55, measurements.hipCm, t / 0.35);
    }

    return lerp(measurements.hipCm, measurements.waistCm, (t - 0.35) / 0.65);
  }

  if (t < 0.2) {
    return lerp(measurements.hipCm, measurements.hipCm, t / 0.2);
  }

  if (t < 0.5) {
    return lerp(measurements.hipCm, measurements.waistCm, (t - 0.2) / 0.3);
  }

  if (t < 0.8) {
    return lerp(measurements.waistCm, measurements.chestCm, (t - 0.5) / 0.3);
  }

  const shoulderScale = category === 'outerwear' ? 0.82 : 0.72;
  return lerp(measurements.chestCm, measurements.chestCm * shoulderScale, (t - 0.8) / 0.2);
}

function halfPanelWidthM(
  t: number,
  category: GarmentCategory,
  measurements: PatternMeasurements,
): number {
  return girthCmAt(t, category, measurements) / 100 / 4;
}

function rowT(row: number): number {
  return row / (GRID_ROWS - 1);
}

function placeGrid(category: GarmentCategory, measurements: PatternMeasurements): number[] {
  const vertices = new Array<number>(GRID_ROWS * GRID_COLS * 2);
  const lengthM = measurements.lengthCm / 100;

  for (let row = 0; row < GRID_ROWS; row += 1) {
    const t = rowT(row);
    const width = halfPanelWidthM(t, category, measurements);
    const y = t * lengthM;
    for (let col = 0; col < GRID_COLS; col += 1) {
      const index = vertexIndex(row, col) * 2;
      vertices[index] = (col / (GRID_COLS - 1)) * width;
      vertices[index + 1] = y;
    }
  }

  return vertices;
}

function buildEdges(): Array<[number, number]> {
  const edges: Array<[number, number]> = [];

  const push = (a: number, b: number): void => {
    if (a < b) {
      edges.push([a, b]);
    } else {
      edges.push([b, a]);
    }
  };

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const index = vertexIndex(row, col);
      if (col + 1 < GRID_COLS) {
        push(index, vertexIndex(row, col + 1));
      }
      if (row + 1 < GRID_ROWS) {
        push(index, vertexIndex(row + 1, col));
      }
      if (row + 1 < GRID_ROWS && col + 1 < GRID_COLS) {
        push(index, vertexIndex(row + 1, col + 1));
        push(vertexIndex(row, col + 1), vertexIndex(row + 1, col));
      }
    }
  }

  return edges;
}

const GRID_EDGES = buildEdges();

function laplacianNeighbors(): number[][] {
  const neighbors: number[][] = Array.from({ length: GRID_ROWS * GRID_COLS }, () => []);

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const index = vertexIndex(row, col);
      if (col > 0) {
        neighbors[index].push(vertexIndex(row, col - 1));
      }
      if (col + 1 < GRID_COLS) {
        neighbors[index].push(vertexIndex(row, col + 1));
      }
      if (row > 0) {
        neighbors[index].push(vertexIndex(row - 1, col));
      }
      if (row + 1 < GRID_ROWS) {
        neighbors[index].push(vertexIndex(row + 1, col));
      }
    }
  }

  return neighbors;
}

const NEIGHBORS = laplacianNeighbors();
const VERTEX_COUNT = GRID_ROWS * GRID_COLS;

function laplacianMatrix(): number[][] {
  const matrix = Array.from({ length: VERTEX_COUNT }, () => new Array<number>(VERTEX_COUNT).fill(0));

  for (let index = 0; index < VERTEX_COUNT; index += 1) {
    const adjacent = NEIGHBORS[index];
    matrix[index][index] = adjacent.length;
    for (const neighbor of adjacent) {
      matrix[index][neighbor] = -1;
    }
  }

  return matrix;
}

const LAPLACIAN = laplacianMatrix();

function multiplyMatrixVector(matrix: number[][], vector: number[]): number[] {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
}

function solveLinearSystem(matrix: number[][], rhs: number[]): number[] | null {
  const size = rhs.length;
  const augmented = matrix.map((row, index) => [...row, rhs[index]]);

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) {
        pivot = row;
      }
    }

    if (Math.abs(augmented[pivot][column]) < 1e-10) {
      return null;
    }

    if (pivot !== column) {
      const swap = augmented[column];
      augmented[column] = augmented[pivot];
      augmented[pivot] = swap;
    }

    const divisor = augmented[column][column];
    for (let index = column; index <= size; index += 1) {
      augmented[column][index] /= divisor;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === column) {
        continue;
      }

      const factor = augmented[row][column];
      if (Math.abs(factor) < 1e-15) {
        continue;
      }

      for (let index = column; index <= size; index += 1) {
        augmented[row][index] -= factor * augmented[column][index];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

function restLengthsFromVertices(vertices: number[]): number[] {
  return GRID_EDGES.map(([left, right]) => {
    const dx = vertices[left * 2] - vertices[right * 2];
    const dy = vertices[left * 2 + 1] - vertices[right * 2 + 1];
    return Math.hypot(dx, dy);
  });
}

function toMesh(
  category: GarmentCategory,
  sizeCode: string,
  measurements: PatternMeasurements,
  vertices: number[],
): RestLengthMesh {
  return {
    schema: REST_LENGTH_SCHEMA,
    category,
    sizeCode,
    measurements: {
      chestCm: measurements.chestCm,
      waistCm: measurements.waistCm,
      hipCm: measurements.hipCm,
      lengthCm: measurements.lengthCm,
    },
    rows: GRID_ROWS,
    cols: GRID_COLS,
    vertices,
    edges: GRID_EDGES.map(([left, right]) => [left, right]),
    restLengths: restLengthsFromVertices(vertices),
  };
}

function deformWithLaplacian(
  baseVertices: number[],
  category: GarmentCategory,
  target: PatternMeasurements,
): number[] {
  const baseX = Array.from({ length: VERTEX_COUNT }, (_, index) => baseVertices[index * 2]);
  const baseY = Array.from({ length: VERTEX_COUNT }, (_, index) => baseVertices[index * 2 + 1]);
  const deltaX = multiplyMatrixVector(LAPLACIAN, baseX);
  const deltaY = multiplyMatrixVector(LAPLACIAN, baseY);

  const constrainedX = new Map<number, number>();
  const constrainedY = new Map<number, number>();
  const lengthM = target.lengthCm / 100;

  for (let row = 0; row < GRID_ROWS; row += 1) {
    const t = rowT(row);
    const width = halfPanelWidthM(t, category, target);

    for (let col = 0; col < GRID_COLS; col += 1) {
      const index = vertexIndex(row, col);
      if (row === 0) {
        constrainedY.set(index, 0);
      }
      if (row === GRID_ROWS - 1) {
        constrainedY.set(index, lengthM);
      }
      if (col === 0) {
        constrainedX.set(index, 0);
      }
      if (col === GRID_COLS - 1) {
        constrainedX.set(index, width);
      }
    }
  }

  const applyConstraints = (delta: number[], constrained: Map<number, number>): number[] | null => {
    const matrix = LAPLACIAN.map((row) => [...row]);
    const rhs = [...delta];
    for (const [index, value] of constrained) {
      for (let column = 0; column < VERTEX_COUNT; column += 1) {
        matrix[index][column] = 0;
      }
      matrix[index][index] = 1;
      rhs[index] = value;
    }

    return solveLinearSystem(matrix, rhs);
  };

  const solvedX = applyConstraints(deltaX, constrainedX);
  const solvedY = applyConstraints(deltaY, constrainedY);
  if (!solvedX || !solvedY) {
    return placeGrid(category, target);
  }

  const vertices = new Array<number>(VERTEX_COUNT * 2);
  for (let index = 0; index < VERTEX_COUNT; index += 1) {
    vertices[index * 2] = solvedX[index];
    vertices[index * 2 + 1] = solvedY[index];
  }

  return vertices;
}

export function buildRestLengthMesh(
  category: GarmentCategory,
  sizeCode: string,
  measurements: PatternMeasurements,
): RestLengthMesh {
  return toMesh(category, sizeCode, measurements, placeGrid(category, measurements));
}

/**
 * Legacy uniform Laplacian grader. Product ingest no longer calls this —
 * persist-garment dispatches Cog task=pattern (GarmentCode MIT, 2D re-instantiate).
 * Kept only so existing rest-length JSON can still be inspected.
 */
export function gradeRestLengthSet(
  category: GarmentCategory,
  variants: ReadonlyArray<PatternMeasurements & { sizeCode: string }>,
): RestLengthMesh[] {
  if (variants.length === 0) {
    return [];
  }

  const ranked = [...variants].sort((left, right) => {
    const rank = (sizeCode: string): number => {
      const order = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
      const index = order.indexOf(sizeCode.trim().toUpperCase());
      return index === -1 ? Number.POSITIVE_INFINITY : index;
    };

    return rank(left.sizeCode) - rank(right.sizeCode);
  });

  const base =
    ranked.find((variant) => variant.sizeCode.trim().toUpperCase() === 'M') ??
    ranked[Math.floor(ranked.length / 2)];
  const baseVertices = placeGrid(category, base);

  return variants.map((variant) => {
    const isBase =
      variant.sizeCode === base.sizeCode
      && variant.chestCm === base.chestCm
      && variant.lengthCm === base.lengthCm;
    const vertices = isBase
      ? baseVertices
      : deformWithLaplacian(baseVertices, category, variant);
    return toMesh(category, variant.sizeCode, variant, vertices);
  });
}
