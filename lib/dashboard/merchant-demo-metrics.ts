/**
 * Static local-dev telemetry snapshot for the standalone merchant dashboard.
 * Values are presentation-ready; no Clerk or Supabase session is required.
 */

export const merchantStores = ['Nordstrom Digital', 'Ashrium Demo Store'] as const;

export type MerchantStore = (typeof merchantStores)[number];

export const merchantDateRanges = ['Last 90 days', 'Last 30 days', 'Last 7 days'] as const;

export type MerchantDateRange = (typeof merchantDateRanges)[number];

export const merchantKpis = {
  overallReturnRate: {
    label: 'Overall return rate',
    value: '14.2%',
    detail: '↓18.4% vs baseline',
    accent: 'success',
    guaranteeMet: true,
    guaranteeLabel: 'Guarantee met',
    guaranteeThreshold: '>15%',
  },
  sizeReturnDelta: {
    label: 'Size return delta',
    value: '-6.8pp',
    detail: '73% fit-attributed',
    accent: 'accent',
    confidencePercent: 73,
  },
  fitSessions: {
    label: 'Fit sessions · GPU',
    value: '284,119',
    detail: '+3.2k/hr',
    accent: 'accent',
    poolLabel: 'A100 pool: 0ms cold start',
  },
  retainedRevenue: {
    label: 'Revenue retained',
    value: '$1.24M',
    detail: '+$218k',
    accent: 'success',
    averageOrder: '$87.40',
    unitsSaved: '14K',
  },
} as const;

export const merchantTrend = {
  baselineRate: '18.5%',
  vfrRate: '14.2%',
  months: ['May', 'Jun', 'Jul', 'Aug'] as const,
} as const;

export const merchantLastSyncIso = '2026-08-15T13:40:00.000Z';

export function formatMerchantTimestamp(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid merchant timestamp: ${iso}`);
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
}

export interface CadPipelineRow {
  sku: string;
  garment: string;
  pipeline: string;
  status: 'Ready' | 'Processing' | 'Review';
  mesh: string;
  tensileStiffness: string;
  bendingRigidity: string;
}

export const cadPipelineRows: readonly CadPipelineRow[] = [
  {
    sku: 'NORD-TEE-014',
    garment: 'Cloud Weight Tee',
    pipeline: 'Sewformer / SPnet',
    status: 'Ready',
    mesh: 'SKEL-04',
    tensileStiffness: '1.20',
    bendingRigidity: '0.18',
  },
  {
    sku: 'NORD-JKT-108',
    garment: 'Technical Shell',
    pipeline: 'Sewformer / SPnet',
    status: 'Processing',
    mesh: 'SKEL-07',
    tensileStiffness: '2.60',
    bendingRigidity: '0.42',
  },
  {
    sku: 'NORD-DRS-022',
    garment: 'Bias Midi Dress',
    pipeline: 'Sewformer / SPnet',
    status: 'Review',
    mesh: 'SKEL-05',
    tensileStiffness: '0.82',
    bendingRigidity: '0.09',
  },
  {
    sku: 'NORD-DNM-011',
    garment: 'Selvedge Taper Jean',
    pipeline: 'Sewformer / SPnet',
    status: 'Ready',
    mesh: 'SKEL-03',
    tensileStiffness: '3.10',
    bendingRigidity: '0.55',
  },
];
