import { normalizeFiberName } from '@/lib/catalog/kes-lookup';
import { normalizeSizeCode } from '@/lib/fit/size-recommend';
import type { CatalogSizeVariantInput, GarmentFiberComposition } from '@/types/garment';

/** Longest tokens first so XS/5XL are not swallowed by S/XL. */
const LETTER_SIZE_TOKEN =
  'XXXXL|XXXL|XXS|XXL|7XL|6XL|5XL|4XL|3XL|2XL|XS|XL|S|M|L';

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  );
}

function parsePublishedGirth(raw: string): number | null {
  const matches = [...raw.matchAll(/(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
  const finite = matches.filter((value) => Number.isFinite(value));
  if (finite.length === 0) {
    return null;
  }

  // An elastic range such as "27.6-38.6" is relaxed to fully stretched;
  // shoppers wear it around the middle, so the midpoint is what fits.
  if (finite.length >= 2 && /[-–]/.test(raw)) {
    const low = finite[0] ?? 0;
    const high = finite[finite.length - 1] ?? 0;
    return (low + high) / 2;
  }

  return finite[0] ?? null;
}

function toCentimetres(value: number, unitHint: 'cm' | 'in' | null): number {
  if (unitHint === 'in' || (unitHint === null && value > 0 && value <= 55)) {
    return value * 2.54;
  }

  return value;
}

function detectUnit(text: string): 'cm' | 'in' | null {
  if (/\b(cm|centimet)/i.test(text)) {
    return 'cm';
  }

  if (/\b(in|inch|inches|")\b/i.test(text) || /measurements\s+by\s+inches/i.test(text)) {
    return 'in';
  }

  return null;
}

type GirthKey = 'chestCm' | 'waistCm' | 'hipCm' | 'lengthCm';

function headerGirth(cell: string): GirthKey | 'size' | null {
  const text = cell.trim().toLowerCase();
  if (/^(size|sizes|uk|us|eu)(\b|$)/i.test(text) || /^size\b/i.test(text)) {
    return 'size';
  }

  // Sleeve / shoulder / hem are published on brand charts but are not
  // chest/waist/hip/length. Do not map them and do not let "sleeve length"
  // overwrite garment length.
  if (/\b(sleeve|shoulder|collar|cuff|rise|thigh|hem|bicep|armhole)\b/.test(text)) {
    return null;
  }

  if (/chest|bust/.test(text)) {
    return 'chestCm';
  }

  if (/waist/.test(text)) {
    return 'waistCm';
  }

  if (/\bhips?\b/.test(text)) {
    return 'hipCm';
  }

  if (
    /\b(top\s*length|bottom\s*length|body\s*length|garment\s*length|front\s*length|back\s*length|outseam|inseam|inside\s*leg)\b/.test(
      text,
    )
    || /^(length)\b/.test(text)
    || (/\blength\b/.test(text) && !/\bsleeve\b/.test(text))
  ) {
    return 'lengthCm';
  }

  return null;
}

function extractTables(html: string): string[][][] {
  const tables: string[][][] = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch = tableRe.exec(html);
  while (tableMatch) {
    const rows: string[][] = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch = rowRe.exec(tableMatch[1]);
    while (rowMatch) {
      const cells: string[] = [];
      const cellRe = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
      let cellMatch = cellRe.exec(rowMatch[1]);
      while (cellMatch) {
        cells.push(stripHtml(cellMatch[1]));
        cellMatch = cellRe.exec(rowMatch[1]);
      }

      if (cells.length > 0) {
        rows.push(cells);
      }

      rowMatch = rowRe.exec(tableMatch[1]);
    }

    if (rows.length >= 2) {
      tables.push(rows);
    }

    tableMatch = tableRe.exec(html);
  }

  return tables;
}

function completeMeasurements(
  partial: Partial<Pick<CatalogSizeVariantInput, GirthKey>>,
): Partial<Pick<CatalogSizeVariantInput, GirthKey>> | null {
  if (
    partial.chestCm == null
    && partial.waistCm == null
    && partial.hipCm == null
    && partial.lengthCm == null
  ) {
    return null;
  }

  // Keep only values published by the merchant. Missing chart cells are
  // deliberately retained as missing so downstream ingest stays approximate.
  return partial;
}

function parseHtmlTables(
  html: string,
): Map<string, Partial<Pick<CatalogSizeVariantInput, GirthKey>>> {
  const chart = new Map<string, Partial<Pick<CatalogSizeVariantInput, GirthKey>>>();
  for (const rows of extractTables(html)) {
    const header = rows[0].map((cell) => headerGirth(cell));
    const sizeIndex = header.findIndex((kind) => kind === 'size');
    const girthIndexes = header
      .map((kind, index) => (kind && kind !== 'size' ? { kind, index } : null))
      .filter((entry): entry is { kind: GirthKey; index: number } => entry !== null);

    if (sizeIndex < 0 || girthIndexes.length === 0) {
      continue;
    }

    const unit = detectUnit(rows[0].join(' ')) ?? detectUnit(html);
    for (const row of rows.slice(1)) {
      const sizeCode = normalizeSizeCode(row[sizeIndex] ?? '').slice(0, 16);
      if (!sizeCode) {
        continue;
      }

      const partial: Partial<Pick<CatalogSizeVariantInput, GirthKey>> = {};
      for (const column of girthIndexes) {
        const raw = row[column.index];
        if (!raw) {
          continue;
        }

        const value = parsePublishedGirth(raw);
        if (value === null) {
          continue;
        }

        const cellUnit = detectUnit(raw) ?? unit;
        partial[column.kind] = toCentimetres(value, cellUnit);
      }

      const complete = completeMeasurements(partial);
      if (complete) {
        chart.set(sizeCode, complete);
      }
    }
  }

  return chart;
}

function parseTripletLines(
  text: string,
): Map<string, Partial<Pick<CatalogSizeVariantInput, GirthKey>>> {
  const chart = new Map<string, Partial<Pick<CatalogSizeVariantInput, GirthKey>>>();
  const lineRe = new RegExp(
    `\\b(${LETTER_SIZE_TOKEN})\\b\\s*[:\\-–]\\s*(\\d+(?:\\.\\d+)?)\\s*[-/]\\s*(\\d+(?:\\.\\d+)?)\\s*[-/]\\s*(\\d+(?:\\.\\d+)?)`,
    'gi',
  );
  let match = lineRe.exec(text);
  while (match) {
    const sizeCode = normalizeSizeCode(match[1]);
    const complete = completeMeasurements({
      chestCm: Number(match[2]),
      waistCm: Number(match[3]),
      hipCm: Number(match[4]),
    });
    if (complete) {
      chart.set(sizeCode, complete);
    }

    match = lineRe.exec(text);
  }

  return chart;
}

function parseLabeledGirthRows(
  text: string,
): Map<string, Partial<Pick<CatalogSizeVariantInput, GirthKey>>> {
  const bySize = new Map<string, Partial<Pick<CatalogSizeVariantInput, GirthKey>>>();
  const rowRe = /(chest|bust|waist|hip|hips|length|inseam)\s*(?:\((cm|in|inches)\))?\s*[:\-]\s*([^\n]+)/gi;
  let rowMatch = rowRe.exec(text);
  while (rowMatch) {
    const label = rowMatch[1].toLowerCase();
    const unit = rowMatch[2] ? detectUnit(rowMatch[2]) : detectUnit(rowMatch[0]);
    const girth: GirthKey =
      label === 'waist'
        ? 'waistCm'
        : label === 'hip' || label === 'hips'
          ? 'hipCm'
          : label === 'length' || label === 'inseam'
            ? 'lengthCm'
            : 'chestCm';
    const pairRe = new RegExp(
      `\\b(${LETTER_SIZE_TOKEN})\\b\\s*[:\\-–]?\\s*(\\d+(?:\\.\\d+)?)`,
      'gi',
    );
    let pair = pairRe.exec(rowMatch[3]);
    while (pair) {
      const sizeCode = normalizeSizeCode(pair[1]);
      const current = bySize.get(sizeCode) ?? {};
      current[girth] = toCentimetres(Number(pair[2]), unit);
      bySize.set(sizeCode, current);
      pair = pairRe.exec(rowMatch[3]);
    }

    rowMatch = rowRe.exec(text);
  }

  const chart = new Map<string, Partial<Pick<CatalogSizeVariantInput, GirthKey>>>();
  for (const [sizeCode, partial] of bySize) {
    const complete = completeMeasurements(partial);
    if (complete) {
      chart.set(sizeCode, complete);
    }
  }

  return chart;
}

function parseSizeColonGirths(
  text: string,
): Map<string, Partial<Pick<CatalogSizeVariantInput, GirthKey>>> {
  const chart = new Map<string, Partial<Pick<CatalogSizeVariantInput, GirthKey>>>();
  const lineRe = new RegExp(
    `\\b(${LETTER_SIZE_TOKEN})\\b\\s*:\\s*(.*?)(?=\\s+\\b(?:${LETTER_SIZE_TOKEN})\\b\\s*:|$)`,
    'gi',
  );
  let match = lineRe.exec(text);
  while (match) {
    const sizeCode = normalizeSizeCode(match[1]);
    const rest = match[2];
    const unit = detectUnit(rest) ?? detectUnit(text);
    const partial: Partial<Pick<CatalogSizeVariantInput, GirthKey>> = {};
    const girthRe =
      /(front\s*length|back\s*length|top\s*length|bottom\s*length|chest|bust|waist|hips?|inseam|length)\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?/gi;
    let girth = girthRe.exec(rest);
    while (girth) {
      const label = girth[1].toLowerCase();
      const key: GirthKey =
        label === 'waist'
          ? 'waistCm'
          : label === 'hip' || label === 'hips' || label === 'hip'
            ? 'hipCm'
            : /length|inseam/.test(label)
              ? 'lengthCm'
              : 'chestCm';
      const upper = girth[3] ? Number(girth[3]) : Number(girth[2]);
      if (Number.isFinite(upper)) {
        partial[key] = toCentimetres(upper, unit);
      }
      girth = girthRe.exec(rest);
    }

    const complete = completeMeasurements(partial);
    if (complete) {
      chart.set(sizeCode, complete);
    }

    match = lineRe.exec(text);
  }

  return chart;
}

function mergeCharts(
  ...charts: Array<Map<string, Partial<Pick<CatalogSizeVariantInput, GirthKey>>>>
): Map<string, Partial<Pick<CatalogSizeVariantInput, GirthKey>>> {
  const merged = new Map<string, Partial<Pick<CatalogSizeVariantInput, GirthKey>>>();
  for (const chart of charts) {
    for (const [sizeCode, row] of chart) {
      merged.set(sizeCode, { ...merged.get(sizeCode), ...row });
    }
  }

  return merged;
}

/** Below this a chest or hip cannot be an adult circumference: it was measured flat. */
const FLAT_MEASUREMENT_MAX_CM = 76.2;

/**
 * Brand charts often give chest or hip measured flat (half the
 * circumference). When every size of a column is below an adult
 * circumference, the column is doubled. Values are rounded to 0.1 cm.
 */
export function normalizeChartMeasurements(
  chart: Map<string, Partial<Pick<CatalogSizeVariantInput, GirthKey>>>,
): Map<string, Partial<Pick<CatalogSizeVariantInput, GirthKey>>> {
  const rows = [...chart.values()];
  const small = (key: GirthKey): boolean => {
    const values = rows
      .map((row) => row[key])
      .filter((value): value is number => typeof value === 'number' && value > 0);
    return values.length > 0 && values.every((value) => value < FLAT_MEASUREMENT_MAX_CM);
  };
  // A small chart for a petite size is still a full circumference, so a
  // second signal is needed: chest flat when no other girth is given or it
  // is under 3/4 of the hip; hip flat when it is under the waist.
  const below = (key: GirthKey, other: GirthKey, ratio: number): boolean =>
    rows.every((row) => {
      const value = row[key];
      const reference = row[other];
      return typeof value !== 'number' || typeof reference !== 'number' || value < reference * ratio;
    });
  const hasOther = (key: GirthKey): boolean => rows.some((row) => typeof row[key] === 'number');
  const doubled = new Set<GirthKey>();
  if (small('chestCm') && (!hasOther('hipCm') || below('chestCm', 'hipCm', 0.75))) {
    doubled.add('chestCm');
  }
  if (small('hipCm') && hasOther('waistCm') && below('hipCm', 'waistCm', 1)) {
    doubled.add('hipCm');
  }
  const normalized = new Map<string, Partial<Pick<CatalogSizeVariantInput, GirthKey>>>();
  for (const [sizeCode, row] of chart) {
    const next: Partial<Pick<CatalogSizeVariantInput, GirthKey>> = {};
    for (const key of ['chestCm', 'waistCm', 'hipCm', 'lengthCm'] as const) {
      const value = row[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        next[key] = Math.round((doubled.has(key) ? value * 2 : value) * 10) / 10;
      }
    }
    normalized.set(sizeCode, next);
  }
  return normalized;
}

export function scanSizeChartFromPage(
  htmlOrText: string,
): Map<string, Partial<Pick<CatalogSizeVariantInput, GirthKey>>> {
  // A real table is the merchant's chart; the text heuristics below would
  // also read things like the model's own measurements, so they only run
  // when there is no table.
  const tables = parseHtmlTables(htmlOrText);
  if (tables.size > 0) {
    return normalizeChartMeasurements(tables);
  }

  const text = stripHtml(htmlOrText);
  return normalizeChartMeasurements(mergeCharts(
    parseTripletLines(text),
    parseLabeledGirthRows(text),
    parseSizeColonGirths(text),
  ));
}

export function parseCompositionText(
  text: string,
  options?: { allowBareFiber?: boolean },
): GarmentFiberComposition | null {
  const composition: GarmentFiberComposition = {};
  // "Cotton content is at least 80% but less than 90%" (US labelling ranges).
  const ranged = /\b([A-Za-z]+)\s+content\s+is\s+at\s+least\s+(\d+(?:\.\d+)?)\s*%\s*(?:and|but)\s+less\s+than\s+(\d+(?:\.\d+)?)\s*%/i.exec(text);
  if (ranged) {
    const amount = Math.round((Number(ranged[2]) + Number(ranged[3])) / 2);
    composition[normalizeFiberName(ranged[1])] = amount;
    composition.other = 100 - amount;
    return composition;
  }

  // One word per fibre: "95%cotton,5%spandex", "Cotton 60%".
  const percentFirst = Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*%\s*([A-Za-z]+)/g));
  const nameFirst = Array.from(text.matchAll(/\b([A-Za-z]+)\s+(\d+(?:\.\d+)?)\s*%/g));
  const usePercentFirst = percentFirst.length >= nameFirst.length;
  const matches = usePercentFirst ? percentFirst : nameFirst;

  let total = 0;
  for (const match of matches) {
    const amount = Number(usePercentFirst ? match[1] : match[2]);
    const fiber = normalizeFiberName(usePercentFirst ? match[2] : match[1]);
    // A second block (lining, trim) starts once the first adds up to 100%.
    if (!Number.isFinite(amount) || amount <= 0 || total >= 100) {
      continue;
    }

    composition[fiber] = (composition[fiber] ?? 0) + amount;
    total += amount;
  }

  if (Object.keys(composition).length === 0 && (options?.allowBareFiber ?? true)) {
    const named = text.match(
      /\b(cotton|polyester|wool|linen|silk|nylon|viscose|rayon|elastane|spandex|hemp|cashmere|acrylic|modal|lyocell|tencel)\b/i,
    );
    if (named) {
      composition[normalizeFiberName(named[1])] = 100;
    }
  }

  return Object.keys(composition).length > 0 ? composition : null;
}

export function scanMaterialFromPage(htmlOrText: string): GarmentFiberComposition | null {
  const text = stripHtml(htmlOrText);
  const labeled: string[] = [];
  const labelRe =
    /(?:material|composition|fabric|shell|fibre content|fiber content|main fabric)\s*[:\-]\s*([^\n]{3,180})/gi;
  let match = labelRe.exec(text);
  while (match) {
    labeled.push(match[1]);
    match = labelRe.exec(text);
  }

  for (const rawChunk of labeled) {
    const chunk = rawChunk
      .split(/\b(?:care\s+instructions?|imported|features?|stretch|sheer|model\s+information|product\s+measurements|size)\b/i)[0]
      ?.split(/\blining\b/i)[0] ?? '';
    const parsed = parseCompositionText(chunk, { allowBareFiber: true });
    if (parsed) {
      return parsed;
    }
  }

  return parseCompositionText(text, { allowBareFiber: false });
}
