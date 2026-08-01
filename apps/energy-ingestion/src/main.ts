import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {BigQuery} from '@google-cloud/bigquery';
import {Firestore} from '@google-cloud/firestore';
import {PubSub} from '@google-cloud/pubsub';
import {Storage} from '@google-cloud/storage';
import {
  BatchedBigQueryLoader,
  BigQueryOutputError,
  stagingSchema,
  toStagingRow,
  toValidationErrorRows,
  validationErrorsSchema,
} from './bigquery-loaders.js';
import {createImportId} from './identifiers.js';
import {
  EnergyEventPublisher,
  type EnergyImportStagedData,
  type EnergyImportStagedEvent,
} from './energy-events.js';
import {
  ImportRunStore,
  type ClaimedImport,
  type ImportIdentity,
} from './import-run-store.js';
import {InvalidCsvFileError, parseCsvRows} from './parse-csv-rows.js';

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);
const storage = new Storage();
const bigquery = new BigQuery();
const importRunStore = new ImportRunStore(new Firestore());
const storageFinalizedEvent = 'google.cloud.storage.object.v1.finalized';
const region = requiredEnvironmentVariable('GCP_REGION');
const energyDatasetId = requiredEnvironmentVariable('ENERGY_DATASET_ID');
const energyImportStagedTopicId = requiredEnvironmentVariable(
  'ENERGY_IMPORT_STAGED_TOPIC_ID',
);
const energyEventPublisher = new EnergyEventPublisher(
  new PubSub(),
  energyImportStagedTopicId,
);
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

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set`);
  return value;
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

  res.writeHead(statusCode, {'Content-Type': 'application/json'});
  res.end(JSON.stringify(body));
}

function log(
  severity: 'INFO' | 'WARNING' | 'ERROR',
  data: Record<string, unknown>,
): void {
  console.log(JSON.stringify({severity, ...data}));
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function publishImportStagedEvent(
  data: EnergyImportStagedData,
): Promise<EnergyImportStagedEvent> {
  const {event, messageId} =
    await energyEventPublisher.publishImportStaged(data);
  await importRunStore.markStagedEventPublished(data.importId, event.eventId);
  log('INFO', {
    event: 'energy_import_staged_event_published',
    importId: data.importId,
    stagedEventId: event.eventId,
    pubsubMessageId: messageId,
    topic: energyImportStagedTopicId,
  });
  return event;
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

async function handleStorageEvent(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const eventId = header(req, 'ce-id');
  const eventType = header(req, 'ce-type');

  if (eventType !== storageFinalizedEvent || eventId === undefined) {
    respond(res, 400, {error: 'Unsupported or malformed CloudEvent'});
    return;
  }

  let data: StorageObjectData;

  let importId: string | undefined;
  let identity: ImportIdentity | undefined;
  let claim: ClaimedImport | undefined;
  let stagingLoader: BatchedBigQueryLoader | undefined;
  let validationErrorsLoader: BatchedBigQueryLoader | undefined;
  let importWasStaged = false;

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
    respond(res, 400, {error: 'Invalid Storage event data'});
    return;
  }

  try {
    const bucket = requiredString(data, 'bucket');
    const fileName = requiredString(data, 'name');
    const generation = requiredString(data, 'generation');
    const sizeBytes = requiredSizeBytes(data);
    importId = createImportId(bucket, fileName, generation);
    identity = {
      importId,
      eventId,
      bucketName: bucket,
      objectName: fileName,
      objectGeneration: generation,
      sizeBytes,
    };

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
      await importRunStore.markRejected(identity, 'FILE_TOO_LARGE');
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

    const claimResult = await importRunStore.claim(identity, randomUUID());
    if (claimResult.kind === 'already-finished') {
      if (
        claimResult.status === 'STAGED' &&
        !claimResult.stagedEventPublished
      ) {
        await publishImportStagedEvent({
          importId,
          bucketName: bucket,
          objectName: fileName,
          objectGeneration: generation,
          rowCount: claimResult.rowCount,
          validRowCount: claimResult.validRowCount,
          invalidRowCount: claimResult.invalidRowCount,
        });
      }
      log('INFO', {
        event: 'energy_import_already_finished',
        eventId,
        importId,
        status: claimResult.status,
      });
      respond(res, 200, {
        importId,
        status: claimResult.status,
      });
      return;
    }
    if (claimResult.kind === 'in-progress') {
      log('WARNING', {
        event: 'energy_import_already_processing',
        eventId,
        importId,
      });
      respond(res, 503, {
        importId,
        status: 'PROCESSING',
      });
      return;
    }
    claim = claimResult;

    const dataset = bigquery.dataset(energyDatasetId, {location: region});
    stagingLoader = new BatchedBigQueryLoader(
      bigquery,
      dataset.table('energy_records_staging'),
      region,
      'staging',
      claim.stagingJobId,
      stagingSchema,
      claim.stagingAlreadySucceeded,
    );
    validationErrorsLoader = new BatchedBigQueryLoader(
      bigquery,
      dataset.table('validation_errors'),
      region,
      'validationErrors',
      claim.validationErrorsJobId,
      validationErrorsSchema,
      claim.validationErrorsAlreadySucceeded,
    );
    const processingTimestamp = new Date().toISOString();
    const contents = storage
      .bucket(bucket)
      .file(fileName, {generation})
      .createReadStream();
    const summary = await parseCsvRows(contents, {
      onValidRow: async (row, rowNumber, recordId) => {
        await stagingLoader!.addRow(
          toStagingRow(
            row,
            rowNumber,
            recordId,
            importId!,
            processingTimestamp,
          ),
        );
      },
      onInvalidRow: async (invalidRow, parsedRow) => {
        for (const errorRow of toValidationErrorRows(
          invalidRow,
          parsedRow,
          importId!,
          processingTimestamp,
        )) {
          await validationErrorsLoader!.addRow(errorRow);
        }
      },
    });

    await stagingLoader.finalize();
    await importRunStore.markOutputSucceeded(
      importId,
      claim.ownerId,
      'staging',
    );
    await validationErrorsLoader.finalize();
    await importRunStore.markOutputSucceeded(
      importId,
      claim.ownerId,
      'validationErrors',
    );
    await importRunStore.markStaged(importId, claim.ownerId, {
      rowCount: summary.rowCount,
      validRowCount: summary.validRowCount,
      invalidRowCount: summary.invalidRowCount,
    });
    importWasStaged = true;

    const stagedEvent = await publishImportStagedEvent({
      importId,
      bucketName: bucket,
      objectName: fileName,
      objectGeneration: generation,
      rowCount: summary.rowCount,
      validRowCount: summary.validRowCount,
      invalidRowCount: summary.invalidRowCount,
    });
    log(summary.invalidRowCount === 0 ? 'INFO' : 'WARNING', {
      event: 'energy_import_staged',
      eventId,
      eventType,
      importId,
      bucket,
      fileName,
      generation,
      sizeBytes,
      attemptNumber: claim.attemptNumber,
      stagingJobId: claim.stagingJobId,
      validationErrorsJobId: claim.validationErrorsJobId,
      stagedEventId: stagedEvent.eventId,
      ...summary,
    });

    respond(res, 200, {
      importId,
      status: 'STAGED',
      rowCount: summary.rowCount,
      validRowCount: summary.validRowCount,
      invalidRowCount: summary.invalidRowCount,
    });
  } catch (error) {
    const caughtError =
      error instanceof Error ? error : new Error(String(error));
    stagingLoader?.abort(caughtError);
    validationErrorsLoader?.abort(caughtError);

    if (error instanceof InvalidCsvFileError) {
      if (!identity || !claim) {
        log('ERROR', {
          event: 'energy_import_state_update_failed',
          eventId,
          importId,
          reason: 'Missing claimed import identity',
        });
        respond(res, 500, {error: 'Failed to update import state'});
        return;
      }
      try {
        await importRunStore.markRejected(
          identity,
          'INVALID_CSV',
          error.message,
          claim.ownerId,
        );
      } catch (stateError) {
        log('ERROR', {
          event: 'energy_import_state_update_failed',
          eventId,
          importId,
          reason:
            stateError instanceof Error
              ? stateError.message
              : String(stateError),
        });
        respond(res, 500, {error: 'Failed to update import state'});
        return;
      }
      log('WARNING', {
        event: 'energy_import_rejected',
        eventId,
        importId,
        reason: 'INVALID_CSV',
        details: error.message,
      });
      respond(res, 200, {
        importId,
        status: 'rejected',
        reason: 'INVALID_CSV',
      });
      return;
    }

    if (importId && claim && !importWasStaged) {
      try {
        await importRunStore.markTechnicalFailure(
          importId,
          claim.ownerId,
          caughtError.message,
          error instanceof BigQueryOutputError && error.retryWithNewJobId
            ? error.output
            : undefined,
        );
      } catch (stateError) {
        log('ERROR', {
          event: 'energy_import_state_update_failed',
          eventId,
          importId,
          reason:
            stateError instanceof Error
              ? stateError.message
              : String(stateError),
        });
      }
    }

    log('ERROR', {
      event: 'energy_import_failed',
      eventId,
      importId,
      reason: caughtError.message,
    });
    respond(res, 500, {error: 'Failed to process uploaded file'});
  }
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    respond(res, 200, {status: 'ok'});
    return;
  }

  if (req.method !== 'POST') {
    respond(res, 405, {error: 'Method not allowed'});
    return;
  }

  void handleStorageEvent(req, res);
});

server.listen(port, host, () => {
  console.log(`energy-ingestion listening on http://${host}:${port}`);
});

process.once('SIGTERM', () => {
  log('INFO', {event: 'energy_ingestion_shutting_down'});
  server.close(() => process.exit(0));
});
