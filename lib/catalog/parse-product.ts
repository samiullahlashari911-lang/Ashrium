import { lookupKesProperties } from '@/lib/catalog/kes-lookup';
import { DEFAULT_LETTER_SIZE_CHART, normalizeSizeCode } from '@/lib/fit/size-recommend';
import type { ShopifyMetafield, ShopifyProduct, ShopifyVariant } from '@/lib/catalog/shopify-admin';
import {
  parseCompositionText,
  scanMaterialFromPage,
  scanSizeChartFromPage,
} from '@/lib/catalog/scan-product-page';
import {
  readGarmentCategory,
  type CatalogGarmentDraft,
  type CatalogSizeVariantInput,
  type GarmentCategory,
  type GarmentFiberComposition,
  type GarmentMechanicalProperties,
} from '@/types/garment';

export { parseCompositionText } from '@/lib/catalog/scan-product-page';

const SIZE_OPTION_NAME = /^(size|taille|talla|größe|groesse|misura)$/i;
const LETTER_SIZE = /^(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|OS|ONE SIZE)$/i;

function metafieldValue(fields: readonly ShopifyMetafield[], keys: readonly string[]): string | null {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  const match = fields.find((field) => wanted.has(field.key.toLowerCase()));
  return match && match.value.trim().length > 0 ? match.value.trim() : null;
}

function parseNumber(raw: string | null): number | null {
  if (!raw) {
    return null;
  }

  const match = raw.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }

  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

function parseJson(raw: string | null): unknown {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseGsmValue(raw: string | null): number | null {
  const value = parseNumber(raw);
  if (value === null || value < 40 || value > 800) {
    return null;
  }

  return value;
}

function inferCategory(product: ShopifyProduct): GarmentCategory {
  const metafieldCategory = readGarmentCategory(
    (metafieldValue(product.metafields, ['category', 'garment_category', 'vfr_category']) ?? '').toLowerCase(),
  );
  if (metafieldCategory) {
    return metafieldCategory;
  }

  const haystack = `${product.productType} ${product.tags.join(' ')} ${product.title} ${product.handle}`.toLowerCase();
  if (/\b(pant|pants|trouser|jean|chino|short|legging|jogger|skirt)\b/.test(haystack)) {
    return 'pant';
  }
  if (/\b(dress|gown|jumpsuit|romper)\b/.test(haystack)) {
    return 'dress';
  }
  if (/\b(jacket|coat|parka|hoodie|outerwear|blazer|sweater|cardigan)\b/.test(haystack)) {
    return 'outerwear';
  }
  if (/\b(tee|t-shirt|tshirt|top|polo|shirt|blouse|tank)\b/.test(haystack)) {
    return 'tee';
  }

  return 'other';
}

function parseMechanicalMetafields(
  fields: readonly ShopifyMetafield[],
): GarmentMechanicalProperties | null {
  const kesJson = parseJson(metafieldValue(fields, ['kes', 'kes_properties', 'mechanical']));
  const source = isRecord(kesJson) ? kesJson : {};
  const tensile = parseNumber(
    metafieldValue(fields, ['tensile_stiffness', 'k_stretch', 'st']) ??
      (typeof source.tensileStiffness === 'number' ? String(source.tensileStiffness) : null) ??
      (typeof source.k_stretch === 'number' ? String(source.k_stretch) : null),
  );
  const bending = parseNumber(
    metafieldValue(fields, ['bending_rigidity', 'br']) ??
      (typeof source.bendingRigidity === 'number' ? String(source.bendingRigidity) : null),
  );
  const shear = parseNumber(
    metafieldValue(fields, ['shear_stiffness', 'ss']) ??
      (typeof source.shearStiffness === 'number' ? String(source.shearStiffness) : null),
  );
  const density = parseNumber(
    metafieldValue(fields, ['area_density', 'rho_a']) ??
      (typeof source.areaDensity === 'number' ? String(source.areaDensity) : null),
  );

  if (
    tensile === null
    || bending === null
    || shear === null
    || density === null
    || tensile <= 0
    || bending <= 0
    || shear <= 0
    || density <= 0
  ) {
    return null;
  }

  return {
    tensileStiffness: tensile,
    bendingRigidity: bending,
    shearStiffness: shear,
    areaDensity: density,
  };
}

function readMeasurementMap(value: unknown): Partial<CatalogSizeVariantInput> | null {
  if (!isRecord(value)) {
    return null;
  }

  const chest = parseNumber(
    typeof value.chestCm === 'number' || typeof value.chest_cm === 'number' || typeof value.chest === 'number'
      ? String(value.chestCm ?? value.chest_cm ?? value.chest)
      : typeof value.chestCm === 'string' || typeof value.chest_cm === 'string' || typeof value.chest === 'string'
        ? String(value.chestCm ?? value.chest_cm ?? value.chest)
        : null,
  );
  const waist = parseNumber(
    typeof value.waistCm === 'number' || typeof value.waist_cm === 'number' || typeof value.waist === 'number'
      ? String(value.waistCm ?? value.waist_cm ?? value.waist)
      : typeof value.waistCm === 'string' || typeof value.waist_cm === 'string' || typeof value.waist === 'string'
        ? String(value.waistCm ?? value.waist_cm ?? value.waist)
        : null,
  );
  const hip = parseNumber(
    typeof value.hipCm === 'number' || typeof value.hip_cm === 'number' || typeof value.hip === 'number'
      ? String(value.hipCm ?? value.hip_cm ?? value.hip)
      : typeof value.hipCm === 'string' || typeof value.hip_cm === 'string' || typeof value.hip === 'string'
        ? String(value.hipCm ?? value.hip_cm ?? value.hip)
        : null,
  );
  const length = parseNumber(
    typeof value.lengthCm === 'number' || typeof value.length_cm === 'number' || typeof value.length === 'number'
      ? String(value.lengthCm ?? value.length_cm ?? value.length)
      : typeof value.lengthCm === 'string' || typeof value.length_cm === 'string' || typeof value.length === 'string'
        ? String(value.lengthCm ?? value.length_cm ?? value.length)
        : null,
  );

  if (chest === null && waist === null && hip === null && length === null) {
    return null;
  }

  return {
    chestCm: chest ?? undefined,
    waistCm: waist ?? undefined,
    hipCm: hip ?? undefined,
    lengthCm: length ?? undefined,
  };
}

function parseProductSizeChart(
  fields: readonly ShopifyMetafield[],
): Map<string, Partial<CatalogSizeVariantInput>> {
  const chart = new Map<string, Partial<CatalogSizeVariantInput>>();
  const raw = parseJson(metafieldValue(fields, ['size_chart', 'sizechart', 'measurements', 'size_measurements']));
  if (!isRecord(raw)) {
    return chart;
  }

  for (const [sizeCode, value] of Object.entries(raw)) {
    const measurements = readMeasurementMap(value);
    if (measurements) {
      chart.set(normalizeSizeCode(sizeCode), measurements);
    }
  }

  return chart;
}

function defaultChartForSize(sizeCode: string): CatalogSizeVariantInput | null {
  const normalized = normalizeSizeCode(sizeCode);
  const exact = DEFAULT_LETTER_SIZE_CHART.find((row) => row.sizeCode === normalized);
  if (exact) {
    return {
      sizeCode: exact.sizeCode,
      chestCm: exact.chestCm,
      waistCm: exact.waistCm,
      hipCm: exact.hipCm,
      lengthCm: exact.lengthCm,
      externalSku: null,
      measurementsFromSource: false,
    };
  }

  const medium = DEFAULT_LETTER_SIZE_CHART[1];
  const step = { chest: 8, waist: 8, hip: 8, length: 2 };
  const offsets: Record<string, number> = { XXS: -3, XS: -2, XXL: 2, XXXL: 3, '4XL': 4 };
  const offset = offsets[normalized];
  if (offset === undefined) {
    const waistInches = Number(normalized);
    if (Number.isFinite(waistInches) && waistInches >= 24 && waistInches <= 50) {
      const waistCm = waistInches * 2.54;
      return {
        sizeCode: normalized.slice(0, 16),
        chestCm: waistCm + 16,
        waistCm,
        hipCm: waistCm + 8,
        lengthCm: 78,
        externalSku: null,
        measurementsFromSource: false,
      };
    }

    return {
      sizeCode: normalized.slice(0, 16) || 'OS',
      chestCm: medium.chestCm,
      waistCm: medium.waistCm,
      hipCm: medium.hipCm,
      lengthCm: medium.lengthCm,
      externalSku: null,
      measurementsFromSource: false,
    };
  }

  return {
    sizeCode: normalized,
    chestCm: medium.chestCm + offset * step.chest,
    waistCm: medium.waistCm + offset * step.waist,
    hipCm: medium.hipCm + offset * step.hip,
    lengthCm: medium.lengthCm + offset * step.length,
    externalSku: null,
    measurementsFromSource: false,
  };
}

function variantSizeCode(variant: ShopifyVariant): string {
  const sizeOption = variant.selectedOptions.find((option) => SIZE_OPTION_NAME.test(option.name.trim()));
  if (sizeOption?.value) {
    return normalizeSizeCode(sizeOption.value).slice(0, 16);
  }

  const letter = variant.selectedOptions.find((option) => LETTER_SIZE.test(option.value.trim()));
  if (letter) {
    return normalizeSizeCode(letter.value).slice(0, 16);
  }

  if (variant.selectedOptions.length === 0 || variant.title === 'Default Title') {
    return 'OS';
  }

  return normalizeSizeCode(variant.title).slice(0, 16) || 'OS';
}

function variantHasSizeOption(variant: ShopifyVariant): boolean {
  return variant.selectedOptions.some(
    (option) => SIZE_OPTION_NAME.test(option.name.trim()) || LETTER_SIZE.test(option.value.trim()),
  );
}

function colorwayKey(variant: ShopifyVariant): string {
  const nonSize = variant.selectedOptions.filter(
    (option) => !SIZE_OPTION_NAME.test(option.name.trim()) && !LETTER_SIZE.test(option.value.trim()),
  );
  if (nonSize.length === 0) {
    return '';
  }

  return nonSize.map((option) => option.value.trim()).join(' / ');
}

function slugPart(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, 48);
}

function measurementsForVariant(
  variant: ShopifyVariant,
  productChart: Map<string, Partial<CatalogSizeVariantInput>>,
  sizeCode: string,
): CatalogSizeVariantInput {
  const fromVariant = {
    chestCm: parseNumber(metafieldValue(variant.metafields, ['chest_cm', 'chest', 'bust_cm', 'bust'])),
    waistCm: parseNumber(metafieldValue(variant.metafields, ['waist_cm', 'waist'])),
    hipCm: parseNumber(metafieldValue(variant.metafields, ['hip_cm', 'hip', 'hips_cm', 'hips'])),
    lengthCm: parseNumber(metafieldValue(variant.metafields, ['length_cm', 'length', 'inseam_cm', 'inseam'])),
  };
  const jsonMeasurements = readMeasurementMap(
    parseJson(metafieldValue(variant.metafields, ['measurements', 'size_measurements', 'garment_measurements'])),
  );
  const chart = productChart.get(sizeCode);
  const fallback = defaultChartForSize(sizeCode) ?? defaultChartForSize('M');
  if (!fallback) {
    throw new Error('Default size chart is missing.');
  }

  const chest = fromVariant.chestCm ?? jsonMeasurements?.chestCm ?? chart?.chestCm ?? fallback.chestCm;
  const waist = fromVariant.waistCm ?? jsonMeasurements?.waistCm ?? chart?.waistCm ?? fallback.waistCm;
  const hip = fromVariant.hipCm ?? jsonMeasurements?.hipCm ?? chart?.hipCm ?? fallback.hipCm;
  const length = fromVariant.lengthCm ?? jsonMeasurements?.lengthCm ?? chart?.lengthCm ?? fallback.lengthCm;
  const fromSource =
    fromVariant.chestCm !== null
    || fromVariant.waistCm !== null
    || fromVariant.hipCm !== null
    || fromVariant.lengthCm !== null
    || Boolean(jsonMeasurements)
    || Boolean(chart);

  return {
    sizeCode,
    chestCm: chest,
    waistCm: waist,
    hipCm: hip,
    lengthCm: length,
    externalSku: variant.sku.length > 0 ? variant.sku.slice(0, 128) : null,
    measurementsFromSource: fromSource,
  };
}

function classifyDraft(
  composition: GarmentFiberComposition | null,
  gsm: number | null,
  explicitKes: GarmentMechanicalProperties | null,
  sizes: readonly CatalogSizeVariantInput[],
  category: GarmentCategory,
): Pick<
  CatalogGarmentDraft,
  'mechanical' | 'ingestConfidence' | 'ingestTier' | 'mode' | 'approximateFit'
> {
  const measuredCount = sizes.filter((size) => size.measurementsFromSource).length;
  const hasSizeChart = measuredCount > 0;
  const hasMaterial = composition !== null;
  const kesMapped = lookupKesProperties(composition, gsm, category);

  if (explicitKes) {
    return {
      mechanical: explicitKes,
      ingestConfidence: measuredCount > 0 ? 0.95 : 0.88,
      ingestTier: 1,
      mode: 'A',
      approximateFit: false,
    };
  }

  if (hasSizeChart && hasMaterial) {
    return {
      mechanical: kesMapped,
      ingestConfidence: measuredCount >= 2 ? 0.82 : 0.74,
      ingestTier: 2,
      mode: 'B',
      approximateFit: false,
    };
  }

  return {
    mechanical: kesMapped,
    ingestConfidence: 0.35,
    ingestTier: 2,
    mode: 'C',
    approximateFit: true,
  };
}

function uniqueSizes(sizes: CatalogSizeVariantInput[]): CatalogSizeVariantInput[] {
  const byCode = new Map<string, CatalogSizeVariantInput>();
  for (const size of sizes) {
    const existing = byCode.get(size.sizeCode);
    if (!existing || (!existing.measurementsFromSource && size.measurementsFromSource)) {
      byCode.set(size.sizeCode, size);
    }
  }

  return [...byCode.values()];
}

function productPageCorpus(product: ShopifyProduct, storefrontHtml: string): string {
  const metafieldBlob = product.metafields.map((field) => field.value).join('\n');
  return [storefrontHtml, product.descriptionHtml, product.description, metafieldBlob, product.tags.join(' ')].join(
    '\n',
  );
}

function draftForVariants(
  product: ShopifyProduct,
  variants: ShopifyVariant[],
  colorLabel: string,
  storefrontHtml: string,
): CatalogGarmentDraft {
  const category = inferCategory(product);
  const corpus = productPageCorpus(product, storefrontHtml);
  const composition =
    parseCompositionText(
      metafieldValue(product.metafields, [
        'composition',
        'fabric_composition',
        'fiber_content',
        'material',
        'fabric',
      ]) ?? '',
    )
    ?? scanMaterialFromPage(corpus);
  const gsm =
    parseGsmValue(metafieldValue(product.metafields, ['gsm', 'fabric_weight', 'fabric_weight_gsm', 'weight_gsm']))
    ?? parseGsmValue(corpus.match(/(\d+(?:\.\d+)?)\s*gsm/i)?.[0] ?? null);
  const explicitKes = parseMechanicalMetafields(product.metafields);
  const sizeChart = parseProductSizeChart(product.metafields);
  for (const [sizeCode, row] of scanSizeChartFromPage(corpus)) {
    if (!sizeChart.has(sizeCode)) {
      sizeChart.set(sizeCode, row);
    }
  }

  const sizesFromVariants = uniqueSizes(
    variants.map((variant) => measurementsForVariant(variant, sizeChart, variantSizeCode(variant))),
  );
  const chartOnly: CatalogSizeVariantInput[] = [];
  for (const [sizeCode, partial] of sizeChart.entries()) {
    if (sizesFromVariants.some((size) => size.sizeCode === sizeCode)) {
      continue;
    }

    const fallback = defaultChartForSize(sizeCode) ?? defaultChartForSize('M');
    if (!fallback) {
      continue;
    }

    chartOnly.push({
      sizeCode,
      chestCm: partial.chestCm ?? fallback.chestCm,
      waistCm: partial.waistCm ?? fallback.waistCm,
      hipCm: partial.hipCm ?? fallback.hipCm,
      lengthCm: partial.lengthCm ?? fallback.lengthCm,
      externalSku: null,
      measurementsFromSource: true,
    });
  }
  const sizes = uniqueSizes([...sizesFromVariants, ...chartOnly]);
  const classified = classifyDraft(composition, gsm, explicitKes, sizes, category);
  const colorSlug = slugPart(colorLabel);
  const handleSku = colorSlug ? `${product.handle}-${colorSlug}` : product.handle;
  const firstSku = variants.find((variant) => variant.sku.length > 0)?.sku;
  const sku = (firstSku && variants.length === 1 ? firstSku : handleSku).slice(0, 128);
  const name = colorLabel ? `${product.title} / ${colorLabel}` : product.title;

  return {
    sku,
    name: name.slice(0, 256),
    category,
    composition,
    gsm,
    cadPatternUrl: product.imageUrl,
    sizeVariants: sizes,
    ...classified,
  };
}

export function draftsFromShopifyProduct(
  product: ShopifyProduct,
  storefrontHtml = '',
): CatalogGarmentDraft[] {
  if (product.variants.length === 0) {
    return [];
  }

  const hasSize = product.variants.some(variantHasSizeOption);
  if (!hasSize) {
    return product.variants.map((variant) =>
      draftForVariants(product, [variant], colorwayKey(variant), storefrontHtml),
    );
  }

  const groups = new Map<string, ShopifyVariant[]>();
  for (const variant of product.variants) {
    const key = colorwayKey(variant);
    const group = groups.get(key) ?? [];
    group.push(variant);
    groups.set(key, group);
  }

  return [...groups.entries()].map(([color, variants]) =>
    draftForVariants(product, variants, color, storefrontHtml),
  );
}
