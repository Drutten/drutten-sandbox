import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {BigQueryEnergyRecordReader} from '../src/energy-records.ts';

describe('BigQueryEnergyRecordReader', () => {
  it('reads processed records belonging to the current import', async () => {
    const calls: unknown[] = [];
    const queryRows = async (options: unknown) => {
      calls.push(options);
      return [
        {
          record_id: 'record-1',
          meter_id: 'home-01',
          period_start: '2026-01-01',
          consumption_kwh: '119',
          total_cost_sek: '473.75',
          previous_record_id: 'record-0',
          previous_period_start: '2025-12-01',
          previous_consumption_kwh: '127',
          previous_total_cost_sek: '490.20',
        },
      ];
    };
    const reader = new BigQueryEnergyRecordReader(
      'energy',
      'europe-west1',
      queryRows,
    );

    assert.deepEqual(await reader.findByImportId('import-1'), [
      {
        recordId: 'record-1',
        meterId: 'home-01',
        periodStart: '2026-01-01',
        consumptionKwh: '119',
        totalCostSek: '473.75',
        previousRecordId: 'record-0',
        previousPeriodStart: '2025-12-01',
        previousConsumptionKwh: '127',
        previousTotalCostSek: '490.20',
      },
    ]);

    const call = calls[0] as Record<string, unknown>;
    assert.deepEqual(call.params, {importId: 'import-1'});
    assert.equal(call.location, 'europe-west1');
    const query = String(call.query);
    assert.match(query, /FROM `energy\.energy_records`/);
    assert.match(query, /LAG\(consumption_kwh\) OVER meter_history/);
    assert.match(query, /PARTITION BY meter_id/);
    assert.match(query, /WHERE source_import_id = @importId/);
    assert.ok(
      query.indexOf('LAG(consumption_kwh)') <
        query.indexOf('WHERE source_import_id'),
      'history must be calculated before filtering the current import',
    );
  });

  it('allows the first period for a meter to have no comparison record', async () => {
    const reader = new BigQueryEnergyRecordReader(
      'energy',
      'europe-west1',
      async () => [
        {
          record_id: 'record-1',
          meter_id: 'home-01',
          period_start: '2026-01-01',
          consumption_kwh: '119',
          total_cost_sek: '473.75',
          previous_record_id: null,
          previous_period_start: null,
          previous_consumption_kwh: null,
          previous_total_cost_sek: null,
        },
      ],
    );

    assert.deepEqual(await reader.findByImportId('import-1'), [
      {
        recordId: 'record-1',
        meterId: 'home-01',
        periodStart: '2026-01-01',
        consumptionKwh: '119',
        totalCostSek: '473.75',
        previousRecordId: undefined,
        previousPeriodStart: undefined,
        previousConsumptionKwh: undefined,
        previousTotalCostSek: undefined,
      },
    ]);
  });
});
