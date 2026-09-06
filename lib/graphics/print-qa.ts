/**
 * Print / albedo QA for product images mapped onto GarmentCode UVs.
 *
 * A passing result means the shopper can see a trustworthy SKU color.
 * Failure hides 3D garment visualization and forces Approximate — it does
 * not change the girth-based size number.
 */

export const PRINT_QA_MIN_EDGE_PX = 128;
export const PRINT_QA_MAX_EDGE_PX = 8192;
export const PRINT_QA_MAX_ASPECT = 6;
export const PRINT_QA_MAX_BYTES = 8 * 1024 * 1024;
/** Skin fraction above this prefers a solid fabric color over wrapping the photo. */
export const PRINT_QA_SKIN_TEXTURE_LIMIT = 0.28;
/** Chromatic non-skin pixels required to extract a garment color. */
export const PRINT_QA_MIN_FABRIC_FRACTION = 0.08;

export type PrintQaMode = 'texture' | 'color' | 'off';

export interface PrintQaResult {
  passed: boolean;
  mode: PrintQaMode;
  reason: string | null;
  albedoHex: string | null;
  width: number | null;
  height: number | null;
}

export interface PrintQaImageInput {
  width: number;
  height: number;
  /** RGBA, packed 4 bytes per pixel. Optional when only headers are known. */
  pixels?: Uint8ClampedArray | Uint8Array;
}

export function failedPrintQa(
  reason: string,
  width: number | null = null,
  height: number | null = null,
): PrintQaResult {
  return {
    passed: false,
    mode: 'off',
    reason,
    albedoHex: null,
    width,
    height,
  };
}

export function albedoHexToRgbInteger(hex: string): number {
  const match = /^#?([0-9A-Fa-f]{6})$/.exec(hex.trim());
  if (!match) {
    return 0x5c5348;
  }

  return Number.parseInt(match[1], 16);
}

export function readImageDimensions(
  bytes: Uint8Array,
): { width: number; height: number; format: 'png' | 'jpeg' | 'webp' } | null {
  const png = readPngDimensions(bytes);
  if (png) {
    return { ...png, format: 'png' };
  }

  const jpeg = readJpegDimensions(bytes);
  if (jpeg) {
    return { ...jpeg, format: 'jpeg' };
  }

  const webp = readWebpDimensions(bytes);
  if (webp) {
    return { ...webp, format: 'webp' };
  }

  return null;
}

export function evaluatePrintQaFromBytes(bytes: Uint8Array): PrintQaResult {
  if (bytes.byteLength < 24) {
    return failedPrintQa('too_small');
  }

  if (bytes.byteLength > PRINT_QA_MAX_BYTES) {
    return failedPrintQa('too_large');
  }

  const size = readImageDimensions(bytes);
  if (!size) {
    return failedPrintQa('undecodable');
  }

  return evaluatePrintQaFromImage({ width: size.width, height: size.height });
}

export function evaluatePrintQaFromImage(input: PrintQaImageInput): PrintQaResult {
  const { width, height } = input;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return failedPrintQa('undecodable');
  }

  const minEdge = Math.min(width, height);
  const maxEdge = Math.max(width, height);
  if (minEdge < PRINT_QA_MIN_EDGE_PX) {
    return failedPrintQa('too_small', width, height);
  }

  if (maxEdge > PRINT_QA_MAX_EDGE_PX) {
    return failedPrintQa('too_large', width, height);
  }

  if (maxEdge / minEdge > PRINT_QA_MAX_ASPECT) {
    return failedPrintQa('aspect', width, height);
  }

  if (!input.pixels || input.pixels.length < 4) {
    return {
      passed: true,
      mode: 'texture',
      reason: null,
      albedoHex: null,
      width,
      height,
    };
  }

  const stats = sampleAlbedoPixels(input.pixels);
  if (stats.opaque === 0) {
    return failedPrintQa('empty', width, height);
  }

  const fabricFraction = stats.fabric / stats.opaque;
  if (fabricFraction < PRINT_QA_MIN_FABRIC_FRACTION || stats.albedoHex === null) {
    return failedPrintQa('no_fabric_color', width, height);
  }

  const skinFraction = stats.skin / stats.opaque;
  const mode: PrintQaMode = skinFraction > PRINT_QA_SKIN_TEXTURE_LIMIT ? 'color' : 'texture';
  return {
    passed: true,
    mode,
    reason: null,
    albedoHex: stats.albedoHex,
    width,
    height,
  };
}

interface AlbedoSampleStats {
  opaque: number;
  skin: number;
  fabric: number;
  albedoHex: string | null;
}

function sampleAlbedoPixels(pixels: Uint8ClampedArray | Uint8Array): AlbedoSampleStats {
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];
  let opaque = 0;
  let skin = 0;
  let fabric = 0;
  const stride = 4;
  const step = pixels.length > 96 * 96 * 4 ? 16 : stride;

  for (let offset = 0; offset + 3 < pixels.length; offset += step) {
    const alpha = pixels[offset + 3];
    if (alpha < 24) {
      continue;
    }

    opaque += 1;
    const red = pixels[offset];
    const green = pixels[offset + 1];
    const blue = pixels[offset + 2];
    if (isSkinTone(red, green, blue) || isNearWhite(red, green, blue) || isNearBlack(red, green, blue)) {
      if (isSkinTone(red, green, blue)) {
        skin += 1;
      }
      continue;
    }

    if (!isChromatic(red, green, blue)) {
      continue;
    }

    fabric += 1;
    reds.push(red);
    greens.push(green);
    blues.push(blue);
  }

  return {
    opaque,
    skin,
    fabric,
    albedoHex: reds.length === 0
      ? null
      : rgbToHex(median(reds), median(greens), median(blues)),
  };
}

function isNearWhite(red: number, green: number, blue: number): boolean {
  return red > 232 && green > 232 && blue > 232;
}

function isNearBlack(red: number, green: number, blue: number): boolean {
  return red < 18 && green < 18 && blue < 18;
}

function isChromatic(red: number, green: number, blue: number): boolean {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  return max - min >= 18 || max < 210;
}

function isSkinTone(red: number, green: number, blue: number): boolean {
  if (red < 95 || green < 40 || blue < 20) {
    return false;
  }

  if (red < green || red < blue) {
    return false;
  }

  if (red - green < 15 || red - blue < 15) {
    return false;
  }

  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const saturation = max === 0 ? 0 : 1 - min / max;
  return saturation < 0.55 && green > 55 && blue > 30 && red < 230;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function rgbToHex(red: number, green: number, blue: number): string {
  const toByte = (value: number): string => Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, '0');
  return `#${toByte(red)}${toByte(green)}${toByte(blue)}`;
}

function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.byteLength < 24) {
    return null;
  }

  if (
    bytes[0] !== 0x89
    || bytes[1] !== 0x50
    || bytes[2] !== 0x4e
    || bytes[3] !== 0x47
    || bytes[4] !== 0x0d
    || bytes[5] !== 0x0a
    || bytes[6] !== 0x1a
    || bytes[7] !== 0x0a
  ) {
    return null;
  }

  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint32(16, false),
    height: view.getUint32(20, false),
  };
}

function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 8 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1];
    if (marker === 0xd8) {
      offset += 2;
      continue;
    }

    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    if (marker >= 0xd0 && marker <= 0xd7) {
      offset += 2;
      continue;
    }

    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (
      marker >= 0xc0
      && marker <= 0xcf
      && marker !== 0xc4
      && marker !== 0xc8
      && marker !== 0xcc
      && offset + 8 < bytes.byteLength
    ) {
      return {
        height: (bytes[offset + 5] << 8) | bytes[offset + 6],
        width: (bytes[offset + 7] << 8) | bytes[offset + 8],
      };
    }

    offset += 2 + Math.max(length, 2);
  }

  return null;
}

function readWebpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.byteLength < 30) {
    return null;
  }

  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (riff !== 'RIFF' || webp !== 'WEBP') {
    return null;
  }

  const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (chunk === 'VP8X') {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return { width, height };
  }

  return null;
}
