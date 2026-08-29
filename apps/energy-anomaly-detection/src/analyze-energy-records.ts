import {
  detectConsumptionAnomaly,
  type ConsumptionAnomalyResult,
} from './consumption-anomaly.ts';
import type {EnergyRecord} from './energy-records.ts';

export interface EnergyRecordAnalysis {
  record: EnergyRecord;
  result: ConsumptionAnomalyResult;
}

export function analyzeEnergyRecords(
  records: EnergyRecord[],
): EnergyRecordAnalysis[] {
  return records.map(record => ({
    record,
    result: detectConsumptionAnomaly(
      Number(record.consumptionKwh),
      record.previousConsumptionKwh === undefined
        ? undefined
        : Number(record.previousConsumptionKwh),
    ),
  }));
}
