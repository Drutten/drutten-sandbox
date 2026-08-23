export const CONSUMPTION_INCREASE_THRESHOLD = 0.4;

export type ConsumptionAnomalyReason =
  | 'NO_PREVIOUS_PERIOD'
  | 'ZERO_PREVIOUS_CONSUMPTION'
  | 'WITHIN_THRESHOLD'
  | 'INCREASE_ABOVE_THRESHOLD';

export interface ConsumptionAnomalyResult {
  isAnomaly: boolean;
  changePercent: number | null;
  reason: ConsumptionAnomalyReason;
}

/** Compares one period with its predecessor using the fixed 40% demo rule. */
export function detectConsumptionAnomaly(
  consumptionKwh: number,
  previousConsumptionKwh?: number,
): ConsumptionAnomalyResult {
  assertValidConsumption(consumptionKwh, 'consumptionKwh');

  if (previousConsumptionKwh === undefined) {
    return {
      isAnomaly: false,
      changePercent: null,
      reason: 'NO_PREVIOUS_PERIOD',
    };
  }

  assertValidConsumption(previousConsumptionKwh, 'previousConsumptionKwh');

  if (previousConsumptionKwh === 0) {
    return {
      isAnomaly: false,
      changePercent: null,
      reason: 'ZERO_PREVIOUS_CONSUMPTION',
    };
  }

  const changeRatio =
    (consumptionKwh - previousConsumptionKwh) / previousConsumptionKwh;
  const isAnomaly = changeRatio > CONSUMPTION_INCREASE_THRESHOLD;

  return {
    isAnomaly,
    changePercent: changeRatio * 100,
    reason: isAnomaly ? 'INCREASE_ABOVE_THRESHOLD' : 'WITHIN_THRESHOLD',
  };
}

function assertValidConsumption(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName} must be a finite non-negative number`);
  }
}
