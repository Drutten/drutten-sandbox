import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { Storage } from '@google-cloud/storage';
import { parse } from 'csv-parse';

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);
const storage = new Storage();
const storageFinalizedEvent = 'google.cloud.storage.object.v1.finalized';
// Limits the Eventarc metadata body, not the CSV file downloaded from GCS.
const maxEventBodyBytes = 1024 * 1024;

interface StorageObjectData {
  bucket?: unknown;
  name?: unknown;
  generation?: unknown;
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

export function createImportId(
  bucket: string,
  fileName: string,
  generation: string,
): string {
  return createHash('sha256')
    .update(`${bucket}\n${fileName}\n${generation}`)
    .digest('hex');
}

export async function parseCsvRows(contents: Buffer): Promise<number> {
  const records = Readable.from(contents).pipe(
    parse({
      bom: true,
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }),
  );
  let rowCount = 0;

  // csv-parse exposes records as an async iterable, so only one row is
  // processed at a time. Field validation will be added in the next step.
  for await (const _record of records) {
    rowCount += 1;
  }

  return rowCount;
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

    const [contents] = await storage
      .bucket(bucket)
      .file(fileName, { generation })
      .download();
    const rowCount = await parseCsvRows(contents);

    log('INFO', {
      event: 'energy_import_parsed',
      eventId,
      eventType,
      importId,
      bucket,
      fileName,
      generation,
      sizeBytes: contents.length,
      rowCount,
    });

    respond(res, 200, { importId, status: 'parsed', rowCount });
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
