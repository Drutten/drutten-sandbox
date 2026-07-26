import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import {
  InvalidCsvFileError,
  parseCsvRows,
} from '../src/parse-csv-rows.ts';

const header = [
  'meter_id',
  'period_start',
  'period_end',
  'reading_start_kwh',
  'reading_end_kwh',
  'consumption_kwh',
  'estimated_annual_kwh',
  'subscription_cost_sek',
  'transmission_cost_sek',
  'energy_tax_sek',
  'grid_vat_sek',
  'grid_total_sek',
  'electricity_cost_sek',
  'electricity_annual_fee_sek',
  'electricity_vat_sek',
  'electricity_total_sek',
  'total_cost_sek',
];

const validValues = [
  'home-01',
  '2026-06-01',
  '2026-06-30',
  '3575',
  '3649',
  '74',
  '943',
  '161.10',
  '26.34',
  '26.64',
  '53.52',
  '267.60',
  '61.35',
  '31.56',
  '23.23',
  '116.14',
  '383.74',
];

describe('parseCsvRows', () => {
  it('continues after rows with too few or too many columns', async () => {
    const tooFew = validValues.slice(0, -1);
    const tooMany = [...validValues, 'unexpected'];
    const csv = [
      header.join(','),
      tooFew.join(','),
      validValues.join(','),
      tooMany.join(','),
    ].join('\n');

    const summary = await parseCsvRows(Readable.from(csv));

    assert.equal(summary.rowCount, 3);
    assert.equal(summary.validRowCount, 1);
    assert.equal(summary.invalidRowCount, 2);
    assert.deepEqual(
      summary.invalidRowSample.map(({ rowNumber, errors }) => ({
        rowNumber,
        errors,
      })),
      [
        { rowNumber: 2, errors: ['INVALID_COLUMN_COUNT'] },
        { rowNumber: 4, errors: ['INVALID_COLUMN_COUNT'] },
      ],
    );
    assert.equal(summary.invalidRowSample[0]?.rawRow, tooFew.join(','));
    assert.equal(summary.invalidRowSample[1]?.rawRow, tooMany.join(','));
  });

  it('rejects an unrecoverable CSV syntax error', async () => {
    const csv = `${header.join(',')}\n"unclosed`;

    await assert.rejects(
      parseCsvRows(Readable.from(csv)),
      InvalidCsvFileError,
    );
  });
});
