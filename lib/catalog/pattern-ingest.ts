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

  const allGirthsPublished = draft.sizeVariants.every(
    (variant) =>
      typeof variant.chestCm === 'number'
      && variant.chestCm > 0
      && typeof variant.waistCm === 'number'
      && variant.waistCm > 0
      && typeof variant.hipCm === 'number'
      && variant.hipCm > 0
      && typeof variant.lengthCm === 'number'
      && variant.lengthCm > 0,
  );
  if (!allGirthsPublished) {
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
