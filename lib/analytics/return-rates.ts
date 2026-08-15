import type { StoreTelemetryRow } from '@/types/database';

export interface ReturnRateAnalytics {
  baselineOrders: number;
  baselineReturnRate: number | null;
  baselineSizeReturnRate: number | null;
  guaranteeAchieved: boolean;
  sizeRelatedReductionPercentage: number | null;
  totalOrders: number;
  totalVfrSessions: number;
  vfrOrders: number;
  vfrReturnRate: number | null;
  vfrSizeReturnRate: number | null;
}

const SIZE_RELATED_RETURN_PATTERN =
  /\b(size|fit|fitting|small|large|tight|loose|short|long)\b/i;

function toPercentage(numerator: number, denominator: number): number | null {
  if (denominator === 0) {
    return null;
  }

  return Number(((numerator / denominator) * 100).toFixed(2));
}

function isSizeRelatedReturn(telemetry: StoreTelemetryRow): boolean {
  return telemetry.returned
    && telemetry.return_reason !== null
    && SIZE_RELATED_RETURN_PATTERN.test(telemetry.return_reason);
}

export function calculateReturnRateAnalytics(
  telemetry: StoreTelemetryRow[],
): ReturnRateAnalytics {
  const vfrOrders = telemetry.filter((entry) => entry.vfr_used);
  const baselineOrders = telemetry.filter((entry) => !entry.vfr_used);
  const baselineReturnRate = toPercentage(
    baselineOrders.filter((entry) => entry.returned).length,
    baselineOrders.length,
  );
  const vfrReturnRate = toPercentage(
    vfrOrders.filter((entry) => entry.returned).length,
    vfrOrders.length,
  );
  const baselineSizeReturnRate = toPercentage(
    baselineOrders.filter(isSizeRelatedReturn).length,
    baselineOrders.length,
  );
  const vfrSizeReturnRate = toPercentage(
    vfrOrders.filter(isSizeRelatedReturn).length,
    vfrOrders.length,
  );
  const sizeRelatedReductionPercentage =
    baselineSizeReturnRate !== null
    && vfrSizeReturnRate !== null
    && baselineSizeReturnRate > 0
      ? Number(
        (((baselineSizeReturnRate - vfrSizeReturnRate) / baselineSizeReturnRate) * 100)
          .toFixed(2),
      )
      : null;

  return {
    baselineOrders: baselineOrders.length,
    baselineReturnRate,
    baselineSizeReturnRate,
    guaranteeAchieved: sizeRelatedReductionPercentage !== null
      && sizeRelatedReductionPercentage >= 20,
    sizeRelatedReductionPercentage,
    totalOrders: telemetry.length,
    totalVfrSessions: vfrOrders.length,
    vfrOrders: vfrOrders.length,
    vfrReturnRate,
    vfrSizeReturnRate,
  };
}
