import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { describe, it } from 'node:test';
import type { BigQuery, Table } from '@google-cloud/bigquery';
import {
  BatchedBigQueryLoader,
  stagingSchema,
  toStagingRow,
  toValidationErrorRows,
} from '../src/bigquery-loaders.ts';
import type { CsvRow } from '../src/validate-energy-row.ts';

const validRow: CsvRow = {
  meter_id: ' home-01 ',
  period_start: '2026-06-01',
  period_end: '2026-06-30',
  reading_start_kwh: '3575',
  reading_end_kwh: '3649',
  consumption_kwh: '74',
  estimated_annual_kwh: '',
  grid_area: '3',
  grid_total_sek: '267.60',
  electricity_total_sek: '116.14',
  total_cost_sek: '383.74',
};

describe('BigQuery row mapping', () => {
  it('maps a valid CSV row to the explicit staging schema', () => {
    assert.deepEqual(
      toStagingRow(
        validRow,
        2,
        'record-1',
        'import-1',
        '2026-07-26T10:00:00.000Z',
      ),
      {
        record_id: 'record-1',
        meter_id: 'home-01',
        period_start: '2026-06-01',
        period_end: '2026-06-30',
        reading_start_kwh: '3575',
        reading_end_kwh: '3649',
        consumption_kwh: '74',
        grid_area: '3',
        grid_total_sek: '267.60',
        electricity_total_sek: '116.14',
        total_cost_sek: '383.74',
        source_import_id: 'import-1',
        source_row_number: 2,
        ingested_at: '2026-07-26T10:00:00.000Z',
      },
    );
  });

  it('creates deterministic validation error IDs', () => {
    const invalidRow = {
      rowNumber: 3,
      errors: ['period_start must be a valid date'],
      rawRow: 'home-01,invalid',
    };
    const first = toValidationErrorRows(
      invalidRow,
      validRow,
      'import-1',
      '2026-07-26T10:00:00.000Z',
    );
    const second = toValidationErrorRows(
      invalidRow,
      validRow,
      'import-1',
      '2026-07-26T10:00:00.000Z',
    );

    assert.equal(first[0]?.error_id, second[0]?.error_id);
    assert.equal(first[0]?.field_name, 'period_start');
    assert.equal(first[0]?.error_code, 'INVALID_DATE');
  });

  it('writes batches of at most 1000 rows to one load stream', async () => {
    const chunks: string[] = [];
    let streamCount = 0;
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
      final(callback) {
        callback();
        queueMicrotask(() => stream.emit('complete'));
      },
    });
    const table = {
      createWriteStream() {
        streamCount += 1;
        return stream;
      },
    } as unknown as Table;
    const loader = new BatchedBigQueryLoader(
      {} as BigQuery,
      table,
      'europe-west1',
      'staging',
      'job-1',
      stagingSchema,
    );

    for (let index = 0; index < 1001; index += 1) {
      await loader.addRow({ index });
    }
    await loader.finalize();

    assert.equal(streamCount, 1);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0]?.trim().split('\n').length, 1000);
    assert.equal(chunks[1]?.trim().split('\n').length, 1);
  });
});
