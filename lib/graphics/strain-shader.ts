import * as THREE from 'three';

import { strainHeatmapRgb } from '@/lib/design-tokens';
import { DEFAULT_EASE_CM, FIT_CLEARANCE_RATIOS } from '@/lib/graphics/radial-heatmap';

/**
 * Fragment-shader fit colouring (blue / green / amber / red) for the draped
 * garment, driven by per-vertex clearance rather than strain.
 *
 * The attribute is `aClearanceCm` — garment-to-body distance in centimetres —
 * normalised against the garment's wearing ease. Strain is deliberately not a
 * colour input: slack cloth and a perfect fit both sit at strain ≈ 0, so a
 * strain-driven scale renders an oversized garment as "ideal" green and can
 * never report loose. See `lib/graphics/radial-heatmap.ts` for the shared
 * breakpoint model, which this shader mirrors exactly so the simulated drape,
 * the approximate radial garment, and the legend all agree.
 *
 * Positions are already composited V_final = V_0 + ΔX before upload.
 */
export function createFitShaderMaterial(easeCm: number = DEFAULT_EASE_CM): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: true,
    uniforms: {
      uOpacity: { value: 0.9 },
      uEaseCm: { value: Math.max(easeCm, 1) },
      uSnugEnd: { value: FIT_CLEARANCE_RATIOS.snugEnd },
      uIdealStart: { value: FIT_CLEARANCE_RATIOS.idealStart },
      uIdealEnd: { value: FIT_CLEARANCE_RATIOS.idealEnd },
      uLooseEnd: { value: FIT_CLEARANCE_RATIOS.looseEnd },
      uConstricted: {
        value: new THREE.Vector3(
          strainHeatmapRgb.constricted.r,
          strainHeatmapRgb.constricted.g,
          strainHeatmapRgb.constricted.b,
        ),
      },
      uSnug: {
        value: new THREE.Vector3(
          strainHeatmapRgb.snug.r,
          strainHeatmapRgb.snug.g,
          strainHeatmapRgb.snug.b,
        ),
      },
      uIdeal: {
        value: new THREE.Vector3(
          strainHeatmapRgb.ideal.r,
          strainHeatmapRgb.ideal.g,
          strainHeatmapRgb.ideal.b,
        ),
      },
      uLoose: {
        value: new THREE.Vector3(
          strainHeatmapRgb.loose.r,
          strainHeatmapRgb.loose.g,
          strainHeatmapRgb.loose.b,
        ),
      },
    },
    vertexShader: /* glsl */ `
      attribute float aClearanceCm;
      varying float vClearanceCm;
      varying vec3 vNormal;

      void main() {
        vClearanceCm = aClearanceCm;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      uniform float uEaseCm;
      uniform float uSnugEnd;
      uniform float uIdealStart;
      uniform float uIdealEnd;
      uniform float uLooseEnd;
      uniform vec3 uConstricted;
      uniform vec3 uSnug;
      uniform vec3 uIdeal;
      uniform vec3 uLoose;
      varying float vClearanceCm;
      varying vec3 vNormal;

      vec3 mapClearance(float ratio) {
        if (ratio < 0.0) {
          return uConstricted;
        }
        if (ratio < uSnugEnd) {
          return mix(uConstricted, uSnug, ratio / uSnugEnd);
        }
        if (ratio < uIdealStart) {
          return mix(uSnug, uIdeal, (ratio - uSnugEnd) / (uIdealStart - uSnugEnd));
        }
        if (ratio <= uIdealEnd) {
          return uIdeal;
        }
        return mix(uIdeal, uLoose, min((ratio - uIdealEnd) / (uLooseEnd - uIdealEnd), 1.0));
      }

      void main() {
        float lighting = 0.55 + 0.45 * max(dot(normalize(vNormal), vec3(0.2, 0.8, 0.4)), 0.0);
        vec3 color = mapClearance(vClearanceCm / uEaseCm) * lighting;
        gl_FragColor = vec4(color, uOpacity);
      }
    `,
  });
}
