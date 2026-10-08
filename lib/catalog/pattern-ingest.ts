import { detectUnsupportedGeometry } from '@/lib/catalog/unsupported-geometry';
import type { CatalogGarmentDraft } from '@/types/garment';

const PRODUCT_TEXT_CAP = 16_000;

export function patternProductText(draft: CatalogGarmentDraft): string {
  const text = (draft.ingestCorpus ?? `${draft.name} ${draft.category}`).trim();
  return text.length > PRODUCT_TEXT_CAP ? text.slice(0, PRODUCT_TEXT_CAP) : text;
}

export function shouldDispatchPattern(draft: CatalogGarmentDraft): boolean {
  if (draft.sizeVariants.length === 0) {
    return false;
  }

  // What GarmentCode needs per category (gpu/pattern/instantiate.py): a top
  // or dress needs chest + length, pants need waist or hip + length. Real
  // charts omit the rest (a tee has no hip); the GPU infers those for pattern
  // geometry only, never for the size verdict.
  const published = (value: number | null | undefined): boolean =>
    typeof value === 'number' && value > 0;
  const everySizeGradable = draft.sizeVariants.every((variant) =>
    published(variant.lengthCm)
    && (draft.category === 'pant'
      ? published(variant.waistCm) || published(variant.hipCm)
      : published(variant.chestCm)),
  );
  if (!everySizeGradable) {
    return false;
  }

  const reason = detectUnsupportedGeometry({
    category: draft.category,
    title: draft.name,
    description: draft.ingestCorpus ?? '',
    composition: draft.composition,
  });
  return reason === null;
}
