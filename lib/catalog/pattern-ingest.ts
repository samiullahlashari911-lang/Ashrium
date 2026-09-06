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

  const reason = detectUnsupportedGeometry({
    category: draft.category,
    title: draft.name,
    description: draft.ingestCorpus ?? '',
    composition: draft.composition,
  });
  return reason === null;
}
