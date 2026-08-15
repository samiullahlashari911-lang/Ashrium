/**
 * HMR / SMPL-X body estimation types for the VFR platform.
 * Zero usage of 'any' in compliance with AGENTS.md guardrails.
 */

/** Reconstructed body mesh geometry from HMR inference. */
export interface SmplxMeshGeometry {
  /** Flattened vertex positions [x0, y0, z0, x1, y1, z1, ...]. */
  vertices: number[];
  /** Triangle face indices [i0, i1, i2, ...]. */
  faces: number[];
}

/**
 * SMPL-X 3D body estimation parameters returned by HMR 2.0 inference.
 * - betas: shape coefficients (10-dimensional SMPL-X beta vector)
 * - pose: axis-angle pose parameters (global orient + body joints)
 * - trans: global translation [tx, ty, tz] in meters
 */
export interface SmplxParameters {
  betas: number[];
  pose: number[];
  trans: number[];
  mesh: SmplxMeshGeometry;
}
