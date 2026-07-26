import { createHash } from 'node:crypto';
import { once } from 'node:events';
import type { Writable } from 'node:stream';
import {
  BigQuery,
  type JobLoadMetadata,
  type Table,
} from '@google-cloud/bigquery';
import type { InvalidCsvRow } from './parse-csv-rows.ts';
import type { CsvRow } from './validate-energy-row.ts';

export type LoadOutput = 'staging' | 'validationErrors';

export class BigQueryOutputError extends Error {
  override readonly name = 'BigQueryOutputError';
  readonly output: LoadOutput;
  readonly retryWithNewJobId: boolean;

  constructor(
    output: LoadOutput,
    message: string,
    retryWithNewJobId: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.output = output;
    this.retryWithNewJobId = retryWithNewJobId;
  }
}

const batchSize = 1000;

export class BatchedBigQueryLoader {
  private readonly rows: string[] = [];
  private readonly bigquery: BigQuery;
  private readonly table: Table;
  private readonly region: string;
  readonly output: LoadOutput;
  readonly jobId: string;
  private readonly schema: JobLoadMetadata['schema'];
  private readonly alreadySucceeded: boolean;
  private stream?: Writable;
  private completion?: Promise<void>;

  constructor(
    bigquery: BigQuery,
    table: Table,
    region: string,
    output: LoadOutput,
    jobId: string,
    schema: JobLoadMetadata['schema'],
    alreadySucceeded = false,
  ) {
    this.bigquery = bigquery;
    this.table = table;
    this.region = region;
    this.output = output;
    this.jobId = jobId;
    this.schema = schema;
    this.alreadySucceeded = alreadySucceeded;
  }

  async addRow(row: Record<string, unknown>): Promise<void> {
    if (this.alreadySucceeded) return;

    try {
      this.ensureStream();
      this.rows.push(JSON.stringify(row));

      if (this.rows.length >= batchSize) {
        await this.flush();
      }
    } catch (error) {
      throw this.outputError(error);
    }
  }

  async finalize(): Promise<void> {
    if (this.alreadySucceeded || !this.stream || !this.completion) return;

    try {
      await this.flush();
      this.stream.end();
      await this.completion;
    } catch (error) {
      throw this.outputError(error);
    }
  }

  abort(error: Error): void {
    this.stream?.destroy(error);
  }

  private ensureStream(): void {
    if (this.stream) return;

    this.stream = this.table.createWriteStream({
      jobId: this.jobId,
      sourceFormat: 'NEWLINE_DELIMITED_JSON',
      writeDisposition: 'WRITE_APPEND',
      schema: this.schema,
    });

    this.completion = new Promise<void>((resolve, reject) => {
      this.stream!.once('complete', () => resolve());
      this.stream!.once('error', (error: unknown) => {
        void this.handleStreamError(error).then(resolve, reject);
      });
    });
    // The parser may still be reading the other output when this rejects.
    // Attach a handler immediately and surface the error from finalize().
    void this.completion.catch(() => undefined);
  }

  private async handleStreamError(error: unknown): Promise<void> {
    let outcome: 'success' | 'failed' | 'absent';
    try {
      outcome = await this.resolveJobOutcome();
    } catch (lookupError) {
      throw new BigQueryOutputError(
        this.output,
        errorMessage(error),
        false,
        { cause: lookupError },
      );
    }

    if (outcome === 'success') return;

    if (isDuplicateJobError(error) && outcome === 'absent') {
      throw new BigQueryOutputError(
        this.output,
        `BigQuery reported duplicate job ${this.jobId}, but its status is not available`,
        false,
        { cause: error },
      );
    }

    throw new BigQueryOutputError(
      this.output,
      outcome === 'failed'
        ? `BigQuery job ${this.jobId} failed`
        : errorMessage(error),
      true,
      { cause: error },
    );
  }

  private async resolveJobOutcome(): Promise<
    'success' | 'failed' | 'absent'
  > {
    const job = this.bigquery.job(this.jobId, {
      location: this.region,
    });
    let metadata;
    try {
      [metadata] = await job.getMetadata();
    } catch (error) {
      if (isNotFoundError(error)) return 'absent';
      throw error;
    }

    if (metadata.status?.state !== 'DONE') {
      try {
        await job.promise();
      } catch {
        // Inspect the final metadata below to distinguish a failed job from
        // a transient polling error.
      }
      [metadata] = await job.getMetadata();
    }

    if (metadata.status?.state !== 'DONE') {
      throw new Error(`BigQuery job ${this.jobId} has no final status`);
    }
    return metadata.status.errorResult ? 'failed' : 'success';
  }

  private async flush(): Promise<void> {
    if (this.rows.length === 0 || !this.stream) return;

    const chunk = `${this.rows.join('\n')}\n`;
    this.rows.length = 0;

    if (!this.stream.write(chunk)) {
      await once(this.stream, 'drain');
    }
  }

  private outputError(error: unknown): BigQueryOutputError {
    return error instanceof BigQueryOutputError
      ? error
      : new BigQueryOutputError(
          this.output,
          errorMessage(error),
          false,
          { cause: error },
        );
  }
}

export const stagingSchema: JobLoadMetadata['schema'] = {
  fields: [
    { name: 'record_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'meter_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'period_start', type: 'DATE', mode: 'REQUIRED' },
    { name: 'period_end', type: 'DATE', mode: 'REQUIRED' },
    { name: 'reading_start_kwh', type: 'NUMERIC', mode: 'REQUIRED' },
    { name: 'reading_end_kwh', type: 'NUMERIC', mode: 'REQUIRED' },
    { name: 'consumption_kwh', type: 'NUMERIC', mode: 'REQUIRED' },
    { name: 'estimated_annual_kwh', type: 'NUMERIC', mode: 'NULLABLE' },
    { name: 'grid_area', type: 'STRING', mode: 'NULLABLE' },
    { name: 'subscription_cost_sek', type: 'NUMERIC', mode: 'NULLABLE' },
    { name: 'transmission_cost_sek', type: 'NUMERIC', mode: 'NULLABLE' },
    { name: 'energy_tax_sek', type: 'NUMERIC', mode: 'NULLABLE' },
    { name: 'grid_vat_sek', type: 'NUMERIC', mode: 'NULLABLE' },
    { name: 'grid_total_sek', type: 'NUMERIC', mode: 'REQUIRED' },
    { name: 'electricity_cost_sek', type: 'NUMERIC', mode: 'NULLABLE' },
    {
      name: 'electricity_annual_fee_sek',
      type: 'NUMERIC',
      mode: 'NULLABLE',
    },
    { name: 'electricity_vat_sek', type: 'NUMERIC', mode: 'NULLABLE' },
    { name: 'electricity_total_sek', type: 'NUMERIC', mode: 'REQUIRED' },
    { name: 'total_cost_sek', type: 'NUMERIC', mode: 'REQUIRED' },
    { name: 'source_import_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'source_row_number', type: 'INT64', mode: 'REQUIRED' },
    { name: 'ingested_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
  ],
};

export const validationErrorsSchema: JobLoadMetadata['schema'] = {
  fields: [
    { name: 'error_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'import_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'source_row_number', type: 'INT64', mode: 'REQUIRED' },
    { name: 'field_name', type: 'STRING', mode: 'NULLABLE' },
    { name: 'error_code', type: 'STRING', mode: 'REQUIRED' },
    { name: 'error_message', type: 'STRING', mode: 'REQUIRED' },
    { name: 'raw_row', type: 'JSON', mode: 'REQUIRED' },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
  ],
};

export function toStagingRow(
  row: CsvRow,
  rowNumber: number,
  recordId: string,
  importId: string,
  ingestedAt: string,
): Record<string, unknown> {
  return withoutUndefinedValues({
    record_id: recordId,
    meter_id: normalizedValue(row, 'meter_id'),
    period_start: normalizedValue(row, 'period_start'),
    period_end: normalizedValue(row, 'period_end'),
    reading_start_kwh: normalizedValue(row, 'reading_start_kwh'),
    reading_end_kwh: normalizedValue(row, 'reading_end_kwh'),
    consumption_kwh: normalizedValue(row, 'consumption_kwh'),
    estimated_annual_kwh: normalizedValue(row, 'estimated_annual_kwh'),
    grid_area: normalizedValue(row, 'grid_area'),
    subscription_cost_sek: normalizedValue(row, 'subscription_cost_sek'),
    transmission_cost_sek: normalizedValue(row, 'transmission_cost_sek'),
    energy_tax_sek: normalizedValue(row, 'energy_tax_sek'),
    grid_vat_sek: normalizedValue(row, 'grid_vat_sek'),
    grid_total_sek: normalizedValue(row, 'grid_total_sek'),
    electricity_cost_sek: normalizedValue(row, 'electricity_cost_sek'),
    electricity_annual_fee_sek: normalizedValue(
      row,
      'electricity_annual_fee_sek',
    ),
    electricity_vat_sek: normalizedValue(row, 'electricity_vat_sek'),
    electricity_total_sek: normalizedValue(row, 'electricity_total_sek'),
    total_cost_sek: normalizedValue(row, 'total_cost_sek'),
    source_import_id: importId,
    source_row_number: rowNumber,
    ingested_at: ingestedAt,
  });
}

export function toValidationErrorRows(
  invalidRow: InvalidCsvRow,
  parsedRow: CsvRow,
  importId: string,
  createdAt: string,
): Record<string, unknown>[] {
  return invalidRow.errors.map((message) => {
    const { fieldName, code } = classifyValidationError(message);
    const errorId = createHash('sha256')
      .update(
        [
          importId,
          invalidRow.rowNumber,
          fieldName ?? '',
          code,
          message,
        ].join('|'),
      )
      .digest('hex');

    return withoutUndefinedValues({
      error_id: errorId,
      import_id: importId,
      source_row_number: invalidRow.rowNumber,
      field_name: fieldName,
      error_code: code,
      error_message: message,
      raw_row: {
        parsed: parsedRow,
        rawCsv: invalidRow.rawRow,
      },
      created_at: createdAt,
    });
  });
}

function classifyValidationError(message: string): {
  fieldName?: string;
  code: string;
} {
  if (message === 'INVALID_COLUMN_COUNT') {
    return { code: 'INVALID_COLUMN_COUNT' };
  }

  const fieldName = /^([a-z][a-z0-9_]*)\s/.exec(message)?.[1];
  if (message.endsWith(' is required')) {
    return { fieldName, code: 'REQUIRED_FIELD' };
  }
  if (message.includes('date') || message.startsWith('period_')) {
    return { fieldName, code: 'INVALID_DATE' };
  }
  if (message.includes('cost components')) {
    return { fieldName, code: 'TOTAL_MISMATCH' };
  }
  if (message.includes('meter reading difference')) {
    return { fieldName, code: 'CONSUMPTION_MISMATCH' };
  }
  if (message.includes('SEK amount')) {
    return { fieldName, code: 'INVALID_MONEY' };
  }
  if (message.includes('number') || message.includes('finite')) {
    return { fieldName, code: 'INVALID_NUMBER' };
  }
  return { fieldName, code: 'INVALID_VALUE' };
}

function normalizedValue(row: CsvRow, field: string): string | undefined {
  const value = row[field]?.trim();
  return value === '' ? undefined : value;
}

function withoutUndefinedValues(
  row: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== undefined),
  );
}

function isDuplicateJobError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const candidate = error as {
    code?: number;
    errors?: { reason?: string }[];
  };
  return (
    candidate.code === 409 ||
    candidate.errors?.some(({ reason }) => reason === 'duplicate') === true
  );
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === 404
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
