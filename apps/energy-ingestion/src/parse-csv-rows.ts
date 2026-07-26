import type { Readable } from 'node:stream';
import { CsvError, parse } from 'csv-parse';
import { createRecordId } from './identifiers.ts';
import {
  validateEnergyRow,
  type CsvRow,
} from './validate-energy-row.ts';

export interface InvalidCsvRow {
  rowNumber: number;
  errors: string[];
  rawRow?: string;
}

export interface CsvValidationSummary {
  rowCount: number;
  validRowCount: number;
  invalidRowCount: number;
  invalidRowSample: InvalidCsvRow[];
  invalidRowsTruncated: boolean;
  recordIdSample: string[];
  recordIdsTruncated: boolean;
}

interface ParsedCsvRecord {
  record: CsvRow;
  raw: string;
  info: {
    lines: number;
    error?: {
      code?: string;
    };
  };
}

const summarySampleSize = 10;
const invalidColumnCountError = 'INVALID_COLUMN_COUNT';

export class InvalidCsvFileError extends Error {
  override readonly name = 'InvalidCsvFileError';
}

export async function parseCsvRows(
  contents: Readable,
): Promise<CsvValidationSummary> {
  const parser = parse({
    bom: true,
    columns: true,
    info: true,
    raw: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  });
  const forwardSourceError = (error: Error): void => {
    parser.destroy(error);
  };
  contents.once('error', forwardSourceError);
  const records = contents.pipe(parser);
  let rowCount = 0;
  let validRowCount = 0;
  let invalidRowCount = 0;
  const invalidRowSample: InvalidCsvRow[] = [];
  const recordIdSample: string[] = [];

  try {
    for await (const parsed of records as AsyncIterable<ParsedCsvRecord>) {
      rowCount += 1;

      if (parsed.info.error?.code === 'CSV_RECORD_INCONSISTENT_COLUMNS') {
        invalidRowCount += 1;
        addInvalidRowSample(invalidRowSample, {
          rowNumber: parsed.info.lines,
          errors: [invalidColumnCountError],
          rawRow: parsed.raw.replace(/\r?\n$/, ''),
        });
        continue;
      }

      const result = validateEnergyRow(parsed.record);

      if (result.valid) {
        validRowCount += 1;
        if (recordIdSample.length < summarySampleSize) {
          recordIdSample.push(
            createRecordId(
              parsed.record.meter_id ?? '',
              parsed.record.period_start ?? '',
              parsed.record.period_end ?? '',
            ),
          );
        }
      } else {
        invalidRowCount += 1;
        addInvalidRowSample(invalidRowSample, {
          rowNumber: parsed.info.lines,
          errors: result.errors,
          rawRow: parsed.raw.replace(/\r?\n$/, ''),
        });
      }
    }
  } catch (error) {
    if (error instanceof CsvError) {
      throw new InvalidCsvFileError(error.message, { cause: error });
    }
    throw error;
  } finally {
    contents.off('error', forwardSourceError);
    if (!contents.destroyed) contents.destroy();
    if (!parser.destroyed) parser.destroy();
  }

  return {
    rowCount,
    validRowCount,
    invalidRowCount,
    invalidRowSample,
    invalidRowsTruncated: invalidRowCount > invalidRowSample.length,
    recordIdSample,
    recordIdsTruncated: validRowCount > recordIdSample.length,
  };
}

function addInvalidRowSample(
  sample: InvalidCsvRow[],
  invalidRow: InvalidCsvRow,
): void {
  if (sample.length < summarySampleSize) {
    sample.push(invalidRow);
  }
}
