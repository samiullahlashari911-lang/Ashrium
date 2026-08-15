/**
 * Garment domain models shared by dashboard input and cloth simulation.
 */

export interface GarmentMechanicalProperties {
  /** Tensile stiffness S_t (N/m). */
  tensileStiffness: number;
  /** Bending rigidity B_r (N*m). */
  bendingRigidity: number;
  /** Shear stiffness S_s (N/m). */
  shearStiffness: number;
  /** Area density rho_a (kg/m^2). */
  areaDensity: number;
}
