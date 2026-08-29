import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {analyzeEnergyRecords} from '../src/analyze-energy-records.ts';
import type {EnergyRecord} from '../src/energy-records.ts';

describe('analyzeEnergyRecords', () => {
  it('analyzes every record and finds consumption anomalies', () => {
    const records: EnergyRecord[] = [
      energyRecord({
        recordId: 'record-1',
        consumptionKwh: '141',
        previousConsumptionKwh: '100',
      }),
      energyRecord({
        recordId: 'record-2',
        consumptionKwh: '120',
        previousConsumptionKwh: '100',
      }),
      energyRecord({
        recordId: 'record-3',
        consumptionKwh: '80',
        previousConsumptionKwh: undefined,
      }),
    ];

    const analyses = analyzeEnergyRecords(records);

    assert.equal(analyses.length, 3);
    assert.equal(analyses[0].result.isAnomaly, true);
    assert.equal(analyses[0].result.changePercent, 41);
    assert.equal(analyses[1].result.isAnomaly, false);
    assert.equal(analyses[2].result.reason, 'NO_PREVIOUS_PERIOD');
  });
});

function energyRecord(overrides: Partial<EnergyRecord> = {}): EnergyRecord {
  return {
    recordId: 'record-1',
    meterId: 'home-01',
    periodStart: '2026-01-01',
    consumptionKwh: '100',
    totalCostSek: '400',
    previousRecordId: 'previous-record',
    previousPeriodStart: '2025-12-01',
    previousConsumptionKwh: '100',
    previousTotalCostSek: '390',
    ...overrides,
  };
}
