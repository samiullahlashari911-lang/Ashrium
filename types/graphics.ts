import type { GarmentMechanicalProperties } from '@/types/garment';

/**
 * Graphics and viewport types for the VFR WebGL draping engine.
 */

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

export type PbdMechanicalProperties = GarmentMechanicalProperties;

export interface PbdEnergyBreakdown {
  stretch: number;
  bend: number;
  shear: number;
  gravity: number;
  collision: number;
  total: number;
}
