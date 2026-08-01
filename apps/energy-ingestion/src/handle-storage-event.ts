import {randomUUID} from 'node:crypto';
import type {IncomingMessage, ServerResponse} from 'node:http';
import type {BigQuery} from '@google-cloud/bigquery';
import type {Storage} from '@google-cloud/storage';
import {BigQueryOutputError} from './bigquery-loaders.ts';
import {
  type EnergyEventPublisher,
  type EnergyImportStagedData,
  type EnergyImportStagedEvent,
} from './energy-events.ts';
import {respond} from './http.ts';
import {type ClaimedImport, type ImportRunStore} from './import-run-store.ts';
import {log} from './logging.ts';
import {InvalidCsvFileError} from './parse-csv-rows.ts';
import {stageCsvFile} from './stage-csv-file.ts';
import {
  InvalidStorageEventError,
  parseStorageEvent,
  type StorageFinalizedEvent,
} from './parse-storage-event.ts';

export interface StorageEventHandlerDependencies {
  storage: Storage;
  bigquery: BigQuery;
  importRunStore: ImportRunStore;
  energyEventPublisher: EnergyEventPublisher;
  region: string;
  energyDatasetId: string;
  energyImportStagedTopicId: string;
  maxCsvFileSizeBytes: number;
}

export async function handleStorageEvent(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: StorageEventHandlerDependencies,
): Promise<void> {
  let event: StorageFinalizedEvent;
  try {
    event = await parseStorageEvent(request);
  } catch (error) {
    const eventId =
      error instanceof InvalidStorageEventError ? error.eventId : undefined;
    log('WARNING', {
      event: 'energy_import_event_rejected',
      eventId,
      reason: errorMessage(error),
    });
    respond(response, 400, {error: 'Invalid Storage event data'});
    return;
  }

  let claim: ClaimedImport | undefined;
  let importWasStaged = false;

  try {
    if (!event.objectName.toLowerCase().endsWith('.csv')) {
      logIgnoredFile(event);
      respond(response, 204);
      return;
    }

    if (event.sizeBytes > dependencies.maxCsvFileSizeBytes) {
      await rejectLargeFile(event, dependencies);
      respond(response, 200, {
        importId: event.importId,
        status: 'rejected',
        reason: 'FILE_TOO_LARGE',
      });
      return;
    }

    const claimResult = await dependencies.importRunStore.claim(
      event,
      randomUUID(),
    );
    if (claimResult.kind === 'already-finished') {
      await handleFinishedImport(event, claimResult, dependencies);
      respond(response, 200, {
        importId: event.importId,
        status: claimResult.status,
      });
      return;
    }
    if (claimResult.kind === 'in-progress') {
      log('WARNING', {
        event: 'energy_import_already_processing',
        eventId: event.eventId,
        importId: event.importId,
      });
      // A 503 asks Eventarc to retry after the active processing lease expires.
      respond(response, 503, {
        importId: event.importId,
        status: 'PROCESSING',
      });
      return;
    }
    claim = claimResult;

    const summary = await stageCsvFile(event, claim, dependencies);
    await dependencies.importRunStore.markStaged(
      event.importId,
      claim.ownerId,
      {
        rowCount: summary.rowCount,
        validRowCount: summary.validRowCount,
        invalidRowCount: summary.invalidRowCount,
      },
    );
    importWasStaged = true;

    const stagedEvent = await publishImportStagedEvent(
      {
        importId: event.importId,
        bucketName: event.bucketName,
        objectName: event.objectName,
        objectGeneration: event.objectGeneration,
        rowCount: summary.rowCount,
        validRowCount: summary.validRowCount,
        invalidRowCount: summary.invalidRowCount,
      },
      dependencies,
    );

    log(summary.invalidRowCount === 0 ? 'INFO' : 'WARNING', {
      event: 'energy_import_staged',
      eventId: event.eventId,
      eventType: event.eventType,
      importId: event.importId,
      bucket: event.bucketName,
      fileName: event.objectName,
      generation: event.objectGeneration,
      sizeBytes: event.sizeBytes,
      attemptNumber: claim.attemptNumber,
      stagingJobId: claim.stagingJobId,
      validationErrorsJobId: claim.validationErrorsJobId,
      stagedEventId: stagedEvent.eventId,
      ...summary,
    });
    respond(response, 200, {
      importId: event.importId,
      status: 'STAGED',
      rowCount: summary.rowCount,
      validRowCount: summary.validRowCount,
      invalidRowCount: summary.invalidRowCount,
    });
  } catch (error) {
    await handleImportError(
      error,
      event,
      claim,
      importWasStaged,
      response,
      dependencies,
    );
  }
}

async function handleFinishedImport(
  event: StorageFinalizedEvent,
  result: Extract<
    Awaited<ReturnType<ImportRunStore['claim']>>,
    {kind: 'already-finished'}
  >,
  dependencies: StorageEventHandlerDependencies,
): Promise<void> {
  // Repair a crash after STAGED was persisted but before publication was recorded.
  if (result.status === 'STAGED' && !result.stagedEventPublished) {
    await publishImportStagedEvent(
      {
        importId: event.importId,
        bucketName: event.bucketName,
        objectName: event.objectName,
        objectGeneration: event.objectGeneration,
        rowCount: result.rowCount,
        validRowCount: result.validRowCount,
        invalidRowCount: result.invalidRowCount,
      },
      dependencies,
    );
  }

  log('INFO', {
    event: 'energy_import_already_finished',
    eventId: event.eventId,
    importId: event.importId,
    status: result.status,
  });
}

async function publishImportStagedEvent(
  data: EnergyImportStagedData,
  dependencies: StorageEventHandlerDependencies,
): Promise<EnergyImportStagedEvent> {
  const {event, messageId} =
    await dependencies.energyEventPublisher.publishImportStaged(data);
  await dependencies.importRunStore.markStagedEventPublished(
    data.importId,
    event.eventId,
  );
  log('INFO', {
    event: 'energy_import_staged_event_published',
    importId: data.importId,
    stagedEventId: event.eventId,
    pubsubMessageId: messageId,
    topic: dependencies.energyImportStagedTopicId,
  });
  return event;
}

async function rejectLargeFile(
  event: StorageFinalizedEvent,
  dependencies: StorageEventHandlerDependencies,
): Promise<void> {
  await dependencies.importRunStore.markRejected(event, 'FILE_TOO_LARGE');
  log('WARNING', {
    event: 'energy_import_rejected',
    eventId: event.eventId,
    importId: event.importId,
    bucket: event.bucketName,
    fileName: event.objectName,
    generation: event.objectGeneration,
    sizeBytes: event.sizeBytes,
    maxFileSizeBytes: dependencies.maxCsvFileSizeBytes,
    reason: 'FILE_TOO_LARGE',
  });
}

function logIgnoredFile(event: StorageFinalizedEvent): void {
  log('INFO', {
    event: 'energy_import_ignored',
    eventId: event.eventId,
    importId: event.importId,
    bucket: event.bucketName,
    fileName: event.objectName,
    generation: event.objectGeneration,
    reason: 'File is not a CSV',
  });
}

async function handleImportError(
  error: unknown,
  event: StorageFinalizedEvent,
  claim: ClaimedImport | undefined,
  importWasStaged: boolean,
  response: ServerResponse,
  dependencies: StorageEventHandlerDependencies,
): Promise<void> {
  if (error instanceof InvalidCsvFileError && claim) {
    try {
      await dependencies.importRunStore.markRejected(
        event,
        'INVALID_CSV',
        error.message,
        claim.ownerId,
      );
    } catch (stateError) {
      logStateUpdateFailure(event, stateError);
      respond(response, 500, {error: 'Failed to update import state'});
      return;
    }
    log('WARNING', {
      event: 'energy_import_rejected',
      eventId: event.eventId,
      importId: event.importId,
      reason: 'INVALID_CSV',
      details: error.message,
    });
    // Invalid CSV is a permanent data error; acknowledge it to prevent retries.
    respond(response, 200, {
      importId: event.importId,
      status: 'rejected',
      reason: 'INVALID_CSV',
    });
    return;
  }

  if (claim && !importWasStaged) {
    try {
      await dependencies.importRunStore.markTechnicalFailure(
        event.importId,
        claim.ownerId,
        errorMessage(error),
        error instanceof BigQueryOutputError && error.retryWithNewJobId
          ? error.output
          : undefined,
      );
    } catch (stateError) {
      logStateUpdateFailure(event, stateError);
    }
  }

  log('ERROR', {
    event: 'energy_import_failed',
    eventId: event.eventId,
    importId: event.importId,
    reason: errorMessage(error),
  });
  respond(response, 500, {error: 'Failed to process uploaded file'});
}

function logStateUpdateFailure(
  event: StorageFinalizedEvent,
  error: unknown,
): void {
  log('ERROR', {
    event: 'energy_import_state_update_failed',
    eventId: event.eventId,
    importId: event.importId,
    reason: errorMessage(error),
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
