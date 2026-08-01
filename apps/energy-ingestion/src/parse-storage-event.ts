import type {IncomingMessage} from 'node:http';
import {createImportId} from './identifiers.ts';
import type {ImportIdentity} from './import-run-store.ts';

const storageFinalizedEvent = 'google.cloud.storage.object.v1.finalized';
// This limits the Eventarc metadata body, not the CSV downloaded from GCS.
const maxEventBodyBytes = 1024 * 1024;

interface StorageObjectData {
  bucket?: unknown;
  name?: unknown;
  generation?: unknown;
  size?: unknown;
}

export interface StorageFinalizedEvent extends ImportIdentity {
  eventType: typeof storageFinalizedEvent;
}

export class InvalidStorageEventError extends Error {
  override readonly name = 'InvalidStorageEventError';
  readonly eventId?: string;

  constructor(message: string, eventId?: string, options?: ErrorOptions) {
    super(message, options);
    this.eventId = eventId;
  }
}

export async function parseStorageEvent(
  request: IncomingMessage,
): Promise<StorageFinalizedEvent> {
  const eventId = header(request, 'ce-id');
  const eventType = header(request, 'ce-type');

  if (eventType !== storageFinalizedEvent || eventId === undefined) {
    throw new InvalidStorageEventError(
      'Unsupported or malformed CloudEvent',
      eventId,
    );
  }

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    throw new InvalidStorageEventError('Invalid Storage event data', eventId, {
      cause: error,
    });
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new InvalidStorageEventError(
      'Storage event data must be a JSON object',
      eventId,
    );
  }

  const data = body as StorageObjectData;
  let bucketName: string;
  let objectName: string;
  let objectGeneration: string;
  let sizeBytes: number;
  try {
    bucketName = requiredString(data, 'bucket');
    objectName = requiredString(data, 'name');
    objectGeneration = requiredString(data, 'generation');
    sizeBytes = requiredSizeBytes(data);
  } catch (error) {
    throw new InvalidStorageEventError(errorMessage(error), eventId, {
      cause: error,
    });
  }

  return {
    eventId,
    eventType,
    importId: createImportId(bucketName, objectName, objectGeneration),
    bucketName,
    objectName,
    objectGeneration,
    sizeBytes,
  };
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxEventBodyBytes) {
      throw new Error('Event body exceeds 1 MiB');
    }
    chunks.push(buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function requiredString(
  data: StorageObjectData,
  field: keyof StorageObjectData,
): string {
  const value = data[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new InvalidStorageEventError(
      `Missing required Storage event field: ${field}`,
    );
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
    throw new InvalidStorageEventError(
      'Missing or invalid Storage event field: size',
    );
  }
  return parsed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
