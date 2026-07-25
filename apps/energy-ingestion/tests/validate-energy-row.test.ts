import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  validateEnergyRow,
  type CsvRow,
} from '../src/validate-energy-row.ts';

const validRow: CsvRow = {
  meter_id: 'home-01',
  period_start: '2026-06-01',
  period_end: '2026-06-30',
  reading_start_kwh: '3575',
  reading_end_kwh: '3649',
  consumption_kwh: '74',
  estimated_annual_kwh: '943',
  subscription_cost_sek: '161.10',
  transmission_cost_sek: '26.34',
  energy_tax_sek: '26.64',
  grid_vat_sek: '53.52',
  grid_total_sek: '267.60',
  electricity_cost_sek: '61.35',
  electricity_annual_fee_sek: '31.56',
  electricity_vat_sek: '23.23',
  electricity_total_sek: '116.14',
  total_cost_sek: '383.74',
};

describe('validateEnergyRow', () => {
  it('accepts a valid energy row', () => {
    assert.deepEqual(validateEnergyRow(validRow), {
      valid: true,
      errors: [],
    });
  });

  it('reports multiple validation errors without throwing', () => {
    const result = validateEnergyRow({
      ...validRow,
      meter_id: '',
      period_end: '2026-02-30',
      consumption_kwh: '75',
      total_cost_sek: '-1',
    });

    assert.equal(result.valid, false);
    assert.deepEqual(result.errors, [
      'meter_id is required',
      'period_end must be a valid date',
      'consumption_kwh must match the meter reading difference',
      'total_cost_sek must be a non-negative SEK amount with max 2 decimals',
    ]);
  });

  it('allows one ore of rounding difference but rejects two ore', () => {
    assert.equal(
      validateEnergyRow({ ...validRow, total_cost_sek: '383.75' }).valid,
      true,
    );

    const result = validateEnergyRow({
      ...validRow,
      total_cost_sek: '383.76',
    });
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.includes(
        'total_cost_sek does not match its cost components',
      ),
    );
  });
});
