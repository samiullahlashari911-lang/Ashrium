import { normalizeFiberName } from '@/lib/catalog/kes-lookup';
import { normalizeSizeCode } from '@/lib/fit/size-recommend';
import type { CatalogSizeVariantInput, GarmentFiberComposition } from '@/types/garment';

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

  if (finite.length >= 2 && /[-–]/.test(raw)) {
    return finite[finite.length - 1] ?? null;
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

  if (/chest|bust/.test(text)) {
    return 'chestCm';
  }

  if (/waist/.test(text)) {
    return 'waistCm';
  }

  if (/hip/.test(text)) {
    return 'hipCm';
  }

  if (/length|inseam|inside\s*leg/.test(text)) {
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

    const unit = detectUnit(rows[0].join(' '));
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
  const lineRe =
    /\b(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL)\b\s*[:\-–]\s*(\d+(?:\.\d+)?)\s*[-/]\s*(\d+(?:\.\d+)?)\s*[-/]\s*(\d+(?:\.\d+)?)/gi;
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
    const pairRe = /\b(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL)\b\s*[:\-–]?\s*(\d+(?:\.\d+)?)/gi;
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
  const lineRe =
    /\b(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL)\b\s*:\s*([^\n]+)/gi;
  let match = lineRe.exec(text);
  while (match) {
    const sizeCode = normalizeSizeCode(match[1]);
    const rest = match[2];
    const unit = detectUnit(rest) ?? detectUnit(text);
    const partial: Partial<Pick<CatalogSizeVariantInput, GirthKey>> = {};
    const girthRe = /(chest|bust|waist|hip|hips|length|inseam)\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?/gi;
    let girth = girthRe.exec(rest);
    while (girth) {
      const label = girth[1].toLowerCase();
      const key: GirthKey =
        label === 'waist'
          ? 'waistCm'
          : label === 'hip' || label === 'hips'
            ? 'hipCm'
            : label === 'length' || label === 'inseam'
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

export function scanSizeChartFromPage(
  htmlOrText: string,
): Map<string, Partial<Pick<CatalogSizeVariantInput, GirthKey>>> {
  const text = stripHtml(htmlOrText);
  return mergeCharts(
    parseHtmlTables(htmlOrText),
    parseTripletLines(text),
    parseLabeledGirthRows(text),
    parseSizeColonGirths(text),
  );
}

export function parseCompositionText(
  text: string,
  options?: { allowBareFiber?: boolean },
): GarmentFiberComposition | null {
  const composition: GarmentFiberComposition = {};
  const percentFirst = Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*%\s*([A-Za-z][A-Za-z\-\s]+)/g));
  const nameFirst = Array.from(text.matchAll(/([A-Za-z][A-Za-z\-\s]+?)\s+(\d+(?:\.\d+)?)\s*%/g));
  const matches = percentFirst.length >= nameFirst.length ? percentFirst : nameFirst;

  for (const match of matches) {
    const amount = Number(percentFirst.length >= nameFirst.length ? match[1] : match[2]);
    const fiber = normalizeFiberName(percentFirst.length >= nameFirst.length ? match[2] : match[1]);
    if (!Number.isFinite(amount) || amount <= 0) {
      continue;
    }

    composition[fiber] = (composition[fiber] ?? 0) + amount;
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

  for (const chunk of labeled) {
    const parsed = parseCompositionText(chunk, { allowBareFiber: true });
    if (parsed) {
      return parsed;
    }
  }

  return parseCompositionText(text, { allowBareFiber: false });
}
