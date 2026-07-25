export type CsvRow = Record<string, string | undefined>;

export interface RowValidationResult {
  valid: boolean;
  errors: string[];
}

const requiredTextFields = ['meter_id'] as const;
const requiredNumberFields = [
  'reading_start_kwh',
  'reading_end_kwh',
  'consumption_kwh',
] as const;
const optionalNumberFields = ['estimated_annual_kwh'] as const;
const requiredMoneyFields = [
  'grid_total_sek',
  'electricity_total_sek',
  'total_cost_sek',
] as const;
const optionalMoneyFields = [
  'subscription_cost_sek',
  'transmission_cost_sek',
  'energy_tax_sek',
  'grid_vat_sek',
  'electricity_cost_sek',
  'electricity_annual_fee_sek',
  'electricity_vat_sek',
] as const;

function value(row: CsvRow, field: string): string | undefined {
  const fieldValue = row[field]?.trim();
  return fieldValue === '' ? undefined : fieldValue;
}

function parseDate(
  row: CsvRow,
  field: string,
  errors: string[],
): number | undefined {
  const fieldValue = value(row, field);
  if (fieldValue === undefined) {
    errors.push(`${field} is required`);
    return undefined;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fieldValue);
  if (match === null) {
    errors.push(`${field} must use YYYY-MM-DD`);
    return undefined;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    errors.push(`${field} must be a valid date`);
    return undefined;
  }

  return timestamp;
}

function parseNonNegativeNumber(
  row: CsvRow,
  field: string,
  required: boolean,
  errors: string[],
): number | undefined {
  const fieldValue = value(row, field);
  if (fieldValue === undefined) {
    if (required) {
      errors.push(`${field} is required`);
    }
    return undefined;
  }

  if (!/^\d+(?:\.\d+)?$/.test(fieldValue)) {
    errors.push(`${field} must be a non-negative number`);
    return undefined;
  }

  const parsed = Number(fieldValue);
  if (!Number.isFinite(parsed)) {
    errors.push(`${field} must be a finite number`);
    return undefined;
  }

  return parsed;
}

function parseMoneyInOre(
  row: CsvRow,
  field: string,
  required: boolean,
  errors: string[],
): number | undefined {
  const fieldValue = value(row, field);
  if (fieldValue === undefined) {
    if (required) {
      errors.push(`${field} is required`);
    }
    return undefined;
  }

  if (!/^\d+(?:\.\d{1,2})?$/.test(fieldValue)) {
    errors.push(`${field} must be a non-negative SEK amount with max 2 decimals`);
    return undefined;
  }

  const [kronor, ore = ''] = fieldValue.split('.');
  return Number(kronor) * 100 + Number(ore.padEnd(2, '0'));
}

function validateSum(
  values: Map<string, number>,
  totalField: string,
  componentFields: readonly string[],
  errors: string[],
): void {
  const total = values.get(totalField);
  if (total === undefined) {
    return;
  }

  let componentTotal = 0;
  for (const field of componentFields) {
    const amount = values.get(field);
    if (amount === undefined) {
      return;
    }
    componentTotal += amount;
  }

  if (Math.abs(total - componentTotal) > 1) {
    errors.push(`${totalField} does not match its cost components`);
  }
}

export function validateEnergyRow(row: CsvRow): RowValidationResult {
  const errors: string[] = [];

  for (const field of requiredTextFields) {
    if (value(row, field) === undefined) {
      errors.push(`${field} is required`);
    }
  }

  const periodStart = parseDate(row, 'period_start', errors);
  const periodEnd = parseDate(row, 'period_end', errors);
  if (
    periodStart !== undefined &&
    periodEnd !== undefined &&
    periodStart > periodEnd
  ) {
    errors.push('period_start must be on or before period_end');
  }

  const numbers = new Map<string, number>();
  for (const field of requiredNumberFields) {
    const parsed = parseNonNegativeNumber(row, field, true, errors);
    if (parsed !== undefined) {
      numbers.set(field, parsed);
    }
  }
  for (const field of optionalNumberFields) {
    const parsed = parseNonNegativeNumber(row, field, false, errors);
    if (parsed !== undefined) {
      numbers.set(field, parsed);
    }
  }

  const readingStart = numbers.get('reading_start_kwh');
  const readingEnd = numbers.get('reading_end_kwh');
  const consumption = numbers.get('consumption_kwh');
  if (
    readingStart !== undefined &&
    readingEnd !== undefined &&
    readingEnd < readingStart
  ) {
    errors.push('reading_end_kwh must be at least reading_start_kwh');
  }
  if (
    readingStart !== undefined &&
    readingEnd !== undefined &&
    consumption !== undefined &&
    Math.abs(readingEnd - readingStart - consumption) > 0.001
  ) {
    errors.push('consumption_kwh must match the meter reading difference');
  }

  const money = new Map<string, number>();
  for (const field of requiredMoneyFields) {
    const parsed = parseMoneyInOre(row, field, true, errors);
    if (parsed !== undefined) {
      money.set(field, parsed);
    }
  }
  for (const field of optionalMoneyFields) {
    const parsed = parseMoneyInOre(row, field, false, errors);
    if (parsed !== undefined) {
      money.set(field, parsed);
    }
  }

  validateSum(
    money,
    'grid_total_sek',
    [
      'subscription_cost_sek',
      'transmission_cost_sek',
      'energy_tax_sek',
      'grid_vat_sek',
    ],
    errors,
  );
  validateSum(
    money,
    'electricity_total_sek',
    [
      'electricity_cost_sek',
      'electricity_annual_fee_sek',
      'electricity_vat_sek',
    ],
    errors,
  );
  validateSum(
    money,
    'total_cost_sek',
    ['grid_total_sek', 'electricity_total_sek'],
    errors,
  );

  return { valid: errors.length === 0, errors };
}
