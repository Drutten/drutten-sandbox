import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { Storage } from '@google-cloud/storage';
import { parse } from 'csv-parse';
import { createImportId, createRecordId } from './identifiers.js';
import {
  validateEnergyRow,
  type CsvRow,
} from './validate-energy-row.js';

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);
const storage = new Storage();
const storageFinalizedEvent = 'google.cloud.storage.object.v1.finalized';
// Limits the Eventarc metadata body, not the CSV file downloaded from GCS.
const maxEventBodyBytes = 1024 * 1024;
const maxCsvFileSizeBytes = positiveIntegerEnvironmentVariable(
  'MAX_CSV_FILE_SIZE_BYTES',
);

interface StorageObjectData {
  bucket?: unknown;
  name?: unknown;
  generation?: unknown;
  size?: unknown;
}

function positiveIntegerEnvironmentVariable(name: string): number {
  const value = process.env[name];
  const parsed = Number(value);

  if (
    value === undefined ||
    value.length === 0 ||
    !Number.isSafeInteger(parsed) ||
    parsed <= 0
  ) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function respond(
  res: ServerResponse,
  statusCode: number,
  body?: Record<string, unknown>,
): void {
  if (body === undefined) {
    res.writeHead(statusCode);
    res.end();
    return;
  }

  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function log(
  severity: 'INFO' | 'WARNING' | 'ERROR',
  data: Record<string, unknown>,
): void {
  console.log(JSON.stringify({ severity, ...data }));
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;

    if (size > maxEventBodyBytes) {
      throw new Error('Event body exceeds 1 MiB');
    }

    chunks.push(buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// Ensures a required GCS metadata field is a non-empty string.
function requiredString(
  data: StorageObjectData,
  field: keyof StorageObjectData,
): string {
  const value = data[field];

  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required Storage event field: ${field}`);
  }

  return value;
}

function requiredSizeBytes(data: StorageObjectData): number {
  const parsed = Number(data.size);

  if (
    (typeof data.size !== 'string' && typeof data.size !== 'number') ||
    !Number.isSafeInteger(parsed) ||
    parsed < 0
  ) {
    throw new Error('Missing or invalid Storage event field: size');
  }

  return parsed;
}

interface InvalidCsvRow {
  rowNumber: number;
  errors: string[];
}

interface CsvValidationSummary {
  rowCount: number;
  validRowCount: number;
  invalidRowCount: number;
  invalidRows: InvalidCsvRow[];
  recordIds: string[];
}

export async function parseCsvRows(
  contents: Buffer,
): Promise<CsvValidationSummary> {
  const records = Readable.from(contents).pipe(
    parse({
      bom: true,
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }),
  );
  let rowCount = 0;
  let validRowCount = 0;
  const invalidRows: InvalidCsvRow[] = [];
  const recordIds: string[] = [];

  for await (const record of records) {
    rowCount += 1;
    const result = validateEnergyRow(record as CsvRow);

    if (result.valid) {
      validRowCount += 1;
      recordIds.push(
        createRecordId(
          record.meter_id ?? '',
          record.period_start ?? '',
          record.period_end ?? '',
        ),
      );
    } else {
      invalidRows.push({
        // The header is CSV row 1.
        rowNumber: rowCount + 1,
        errors: result.errors,
      });
    }
  }

  return {
    rowCount,
    validRowCount,
    invalidRowCount: invalidRows.length,
    invalidRows,
    recordIds,
  };
}

async function handleStorageEvent(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const eventId = header(req, 'ce-id');
  const eventType = header(req, 'ce-type');

  if (eventType !== storageFinalizedEvent || eventId === undefined) {
    respond(res, 400, { error: 'Unsupported or malformed CloudEvent' });
    return;
  }

  let data: StorageObjectData;

  try {
    const body = await readJsonBody(req);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new Error('Storage event data must be a JSON object');
    }
    data = body as StorageObjectData;
  } catch (error) {
    log('WARNING', {
      event: 'energy_import_event_rejected',
      eventId,
      reason: error instanceof Error ? error.message : String(error),
    });
    respond(res, 400, { error: 'Invalid Storage event data' });
    return;
  }

  try {
    const bucket = requiredString(data, 'bucket');
    const fileName = requiredString(data, 'name');
    const generation = requiredString(data, 'generation');
    const sizeBytes = requiredSizeBytes(data);
    const importId = createImportId(bucket, fileName, generation);

    if (!fileName.toLowerCase().endsWith('.csv')) {
      log('INFO', {
        event: 'energy_import_ignored',
        eventId,
        importId,
        bucket,
        fileName,
        generation,
        reason: 'File is not a CSV',
      });
      respond(res, 204);
      return;
    }

    if (sizeBytes > maxCsvFileSizeBytes) {
      log('WARNING', {
        event: 'energy_import_rejected',
        eventId,
        importId,
        bucket,
        fileName,
        generation,
        sizeBytes,
        maxFileSizeBytes: maxCsvFileSizeBytes,
        reason: 'FILE_TOO_LARGE',
      });
      // This is a permanent data error, so acknowledge the event without retry.
      respond(res, 200, {
        importId,
        status: 'rejected',
        reason: 'FILE_TOO_LARGE',
      });
      return;
    }

    const [contents] = await storage
      .bucket(bucket)
      .file(fileName, { generation })
      .download();
    const summary = await parseCsvRows(contents);
    const { recordIds, ...validationSummary } = summary;

    log(summary.invalidRowCount === 0 ? 'INFO' : 'WARNING', {
      event: 'energy_import_validated',
      eventId,
      eventType,
      importId,
      bucket,
      fileName,
      generation,
      sizeBytes,
      ...validationSummary,
      recordIdSample: recordIds.slice(0, 10),
      recordIdsTruncated: recordIds.length > 10,
    });

    respond(res, 200, {
      importId,
      status: 'validated',
      rowCount: summary.rowCount,
      validRowCount: summary.validRowCount,
      invalidRowCount: summary.invalidRowCount,
    });
  } catch (error) {
    log('ERROR', {
      event: 'energy_import_failed',
      eventId,
      reason: error instanceof Error ? error.message : String(error),
    });
    respond(res, 500, { error: 'Failed to process uploaded file' });
  }
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    respond(res, 200, { status: 'ok' });
    return;
  }

  if (req.method !== 'POST') {
    respond(res, 405, { error: 'Method not allowed' });
    return;
  }

  void handleStorageEvent(req, res);
});

server.listen(port, host, () => {
  console.log(`energy-ingestion listening on http://${host}:${port}`);
});
