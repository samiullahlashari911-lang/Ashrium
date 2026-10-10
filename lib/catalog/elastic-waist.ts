/**
 * Gathered waists (elastic, drawstring, joggers, leggings): the chart's waist
 * is the relaxed elastic, which stretches over a bigger body waist. Same rule
 * as the GPU pattern's `elastic_waist` (gpu/pattern/style.py).
 */
const ELASTIC_WAIST =
  /\b(elastic|drawstring|jogger|joggers|legging|leggings|sweatpants?|pull[-\s]?on|smocked)\b/i;

export function isElasticWaist(garmentName: string | null | undefined): boolean {
  return Boolean(garmentName && ELASTIC_WAIST.test(garmentName));
}
