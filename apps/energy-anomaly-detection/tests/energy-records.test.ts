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
      },
    ]);

    const call = calls[0] as Record<string, unknown>;
    assert.deepEqual(call.params, {importId: 'import-1'});
    assert.equal(call.location, 'europe-west1');
    assert.match(String(call.query), /FROM `energy\.energy_records`/);
    assert.match(String(call.query), /WHERE source_import_id = @importId/);
  });
});
