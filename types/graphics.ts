import type { GarmentMechanicalProperties } from '@/types/garment';
import { ANNY_HULL_GLB_PUBLIC_PATH, ANNY_TOPOLOGY_VERSION } from '@/types/hmr';

/**
 * Graphics and viewport types for the VFR WebGL draping engine.
 */

export { ANNY_HULL_GLB_PUBLIC_PATH, ANNY_TOPOLOGY_VERSION };

export interface ViewportConfig {
  showHeatmap: boolean;
  showWireframe: boolean;
  autoRotate: boolean;
}

export interface AvatarMeasurements {
  heightCm: number;
  chestCm: number;
  waistCm: number;
}

export interface GarmentMeshProps {
  cadPatternUrl: string;
  tensileStiffness: number;
  bendingRigidity: number;
  shearStiffness: number;
  areaDensity: number;
}

export interface StrainColor {
  r: number;
  g: number;
  b: number;
}

/** Y-binned torso radii from the deformed ANNY hull, used by server XPBD collision. */
export interface HullCollisionField {
  yMin: number;
  yMax: number;
  binCount: number;
  radius: Float32Array;
}

/** Client compositing payload: V_final = restPositions + delta. */
export interface SimDrapeMesh {
  restPositions: Float32Array;
  delta: Float32Array;
  strain: Float32Array;
  /**
   * Per-vertex garment-to-body clearance in centimetres, measured radially
   * against the same Y-binned hull field the collision solver uses. Drives all
   * fit colouring; see `lib/graphics/radial-heatmap.ts` for why strain does not.
   */
  clearanceCm: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  topologyVersion: string;
  meanStrain: number;
}

export type FitDrapeSource = 'cache' | 'xpbd' | 'unavailable';

export interface FitDrapeResolve {
  source: FitDrapeSource;
  similarity: number | null;
  xpbdCompleted: boolean;
  topologyVersion: string;
  meanStrain: number | null;
  payloadBase64: string | null;
}

export type PbdMechanicalProperties = GarmentMechanicalProperties;

export interface PbdEnergyBreakdown {
  stretch: number;
  bend: number;
  shear: number;
  gravity: number;
  collision: number;
  total: number;
}
