import { lookupKesProperties } from '@/lib/catalog/kes-lookup';
import { detectUnsupportedGeometry } from '@/lib/catalog/unsupported-geometry';
import { normalizeSizeCode } from '@/lib/fit/size-recommend';
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

function publishedGirth(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isFullyPublished(
  measurements: Partial<Pick<CatalogSizeVariantInput, 'chestCm' | 'waistCm' | 'hipCm' | 'lengthCm'>>,
): measurements is Pick<CatalogSizeVariantInput, 'chestCm' | 'waistCm' | 'hipCm' | 'lengthCm'> {
  return [measurements.chestCm, measurements.waistCm, measurements.hipCm, measurements.lengthCm].every(
    publishedGirth,
  );
}

function isCategoryComplete(
  category: GarmentCategory,
  measurements: Partial<Pick<CatalogSizeVariantInput, 'chestCm' | 'waistCm' | 'hipCm' | 'lengthCm'>>,
): boolean {
  switch (category) {
    case 'tee':
    case 'outerwear':
      return publishedGirth(measurements.chestCm) && publishedGirth(measurements.lengthCm);
    case 'pant':
      return (
        publishedGirth(measurements.waistCm)
        && publishedGirth(measurements.hipCm)
        && publishedGirth(measurements.lengthCm)
      );
    case 'dress':
      return publishedGirth(measurements.chestCm) && publishedGirth(measurements.lengthCm);
    default:
      return false;
  }
}

const CHILDREN_PRODUCT_RE =
  /\b(kids?|kid'?s|children'?s|child|infant|toddler|baby|babies|youth|boy'?s|girl'?s|boys|girls)\b/i;
const NON_GARMENT_RE =
  /\b(keyboard|mouse|lamp|speaker|headphone|earbud|charger|hdmi|usb|electronics?|gadget|toy|toys|puzzle|home\s*decor|furniture|pillow)\b/i;

function productHaystack(product: ShopifyProduct): string {
  return `${product.productType} ${product.tags.join(' ')} ${product.title} ${product.handle}`.toLowerCase();
}

export function shouldIngestShopifyProduct(product: ShopifyProduct): boolean {
  const haystack = productHaystack(product);
  if (CHILDREN_PRODUCT_RE.test(haystack) || NON_GARMENT_RE.test(haystack)) {
    return false;
  }

  return inferCategory(product) !== 'other';
}

interface VariantMeasurements {
  input: CatalogSizeVariantInput | null;
  hasMissingMeasurements: boolean;
}

function measurementsForVariant(
  variant: ShopifyVariant,
  productChart: Map<string, Partial<CatalogSizeVariantInput>>,
  sizeCode: string,
  category: GarmentCategory,
): VariantMeasurements {
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
  const measurements = {
    chestCm: fromVariant.chestCm ?? jsonMeasurements?.chestCm ?? chart?.chestCm ?? null,
    waistCm: fromVariant.waistCm ?? jsonMeasurements?.waistCm ?? chart?.waistCm ?? null,
    hipCm: fromVariant.hipCm ?? jsonMeasurements?.hipCm ?? chart?.hipCm ?? null,
    lengthCm: fromVariant.lengthCm ?? jsonMeasurements?.lengthCm ?? chart?.lengthCm ?? null,
  };
  const missing = !isFullyPublished(measurements);

  if (!isCategoryComplete(category, measurements)) {
    return { input: null, hasMissingMeasurements: true };
  }

  return {
    input: {
      sizeCode,
      chestCm: measurements.chestCm,
      waistCm: measurements.waistCm,
      hipCm: measurements.hipCm,
      lengthCm: measurements.lengthCm,
      externalSku: variant.sku.length > 0 ? variant.sku.slice(0, 128) : null,
      measurementsFromSource: true,
    },
    hasMissingMeasurements: missing,
  };
}

function classifyDraft(
  composition: GarmentFiberComposition | null,
  gsm: number | null,
  explicitKes: GarmentMechanicalProperties | null,
  sizes: readonly CatalogSizeVariantInput[],
  category: GarmentCategory,
  hasMissingMeasurements: boolean,
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
      approximateFit: hasMissingMeasurements,
    };
  }

  if (hasSizeChart && hasMaterial) {
    return {
      mechanical: kesMapped,
      ingestConfidence: measuredCount >= 2 ? 0.82 : 0.74,
      ingestTier: 2,
      mode: 'B',
      approximateFit: hasMissingMeasurements,
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

  const variantMeasurements = variants.map((variant) =>
    measurementsForVariant(variant, sizeChart, variantSizeCode(variant), category),
  );
  const sizesFromVariants = uniqueSizes(
    variantMeasurements.flatMap((measurement) => (measurement.input ? [measurement.input] : [])),
  );
  let hasMissingMeasurements = variantMeasurements.some(
    (measurement) => measurement.hasMissingMeasurements,
  );
  const chartOnly: CatalogSizeVariantInput[] = [];
  for (const [sizeCode, partial] of sizeChart.entries()) {
    if (sizesFromVariants.some((size) => size.sizeCode === sizeCode)) {
      continue;
    }

    if (!isCategoryComplete(category, partial)) {
      hasMissingMeasurements = true;
      continue;
    }

    chartOnly.push({
      sizeCode,
      chestCm: partial.chestCm ?? null,
      waistCm: partial.waistCm ?? null,
      hipCm: partial.hipCm ?? null,
      lengthCm: partial.lengthCm ?? null,
      externalSku: null,
      measurementsFromSource: true,
    });
    if (!isFullyPublished(partial)) {
      hasMissingMeasurements = true;
    }
  }
  const sizes = uniqueSizes([...sizesFromVariants, ...chartOnly]);
  const classified = classifyDraft(
    composition,
    gsm,
    explicitKes,
    sizes,
    category,
    hasMissingMeasurements,
  );
  const colorSlug = slugPart(colorLabel);
  const handleSku = colorSlug ? `${product.handle}-${colorSlug}` : product.handle;
  const firstSku = variants.find((variant) => variant.sku.length > 0)?.sku;
  const sku = (firstSku && variants.length === 1 ? firstSku : handleSku).slice(0, 128);
  const name = colorLabel ? `${product.title} / ${colorLabel}` : product.title;
  const unsupportedReason = detectUnsupportedGeometry({
    category,
    title: name,
    tags: product.tags,
    description: corpus,
    composition,
  });

  return {
    sku,
    name: name.slice(0, 256),
    category,
    composition,
    gsm,
    cadPatternUrl: product.imageUrl,
    sizeVariants: sizes,
    ingestCorpus: corpus.slice(0, 16_000),
    ...classified,
    approximateFit: classified.approximateFit || unsupportedReason !== null,
  };
}

export function draftsFromShopifyProduct(
  product: ShopifyProduct,
  storefrontHtml = '',
): CatalogGarmentDraft[] {
  if (!shouldIngestShopifyProduct(product) || product.variants.length === 0) {
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
