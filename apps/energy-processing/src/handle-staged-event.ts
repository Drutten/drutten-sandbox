import type {IncomingMessage, ServerResponse} from 'node:http';
import {respond} from './http.ts';
import {log} from './logging.ts';
import {
  InvalidPubSubEventError,
  parsePubSubEvent,
} from './parse-pubsub-event.ts';
import type {StagingRecordReader} from './staging-records.ts';
import type {EnergyRecordMerger} from './energy-record-merger.ts';

export interface StagedEventDependencies {
  stagingRecords: StagingRecordReader;
  energyRecords: EnergyRecordMerger;
}

export async function handleStagedEvent(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: StagedEventDependencies,
): Promise<void> {
  try {
    const delivery = await parsePubSubEvent(request);
    log('INFO', {
      event: 'energy_import_staged_received',
      cloudEventId: delivery.cloudEventId,
      pubsubMessageId: delivery.pubsubMessageId,
      stagedEventId: delivery.event.eventId,
      importId: delivery.event.importId,
      rowCount: delivery.event.rowCount,
      validRowCount: delivery.event.validRowCount,
      invalidRowCount: delivery.event.invalidRowCount,
    });

    const stagingRowCount = await dependencies.stagingRecords.countByImportId(
      delivery.event.importId,
    );
    log('INFO', {
      event: 'energy_staging_records_read',
      importId: delivery.event.importId,
      stagedEventId: delivery.event.eventId,
      stagingRowCount,
      expectedValidRowCount: delivery.event.validRowCount,
      rowCountMatches: stagingRowCount === delivery.event.validRowCount,
    });

    if (stagingRowCount !== delivery.event.validRowCount) {
      throw new Error(
        `Staging row count ${stagingRowCount} does not match expected count ${delivery.event.validRowCount}`,
      );
    }

    const merge = await dependencies.energyRecords.mergeImport(
      delivery.event.importId,
      delivery.event.eventId,
    );
    log('INFO', {
      event: 'energy_records_merged',
      importId: delivery.event.importId,
      stagedEventId: delivery.event.eventId,
      mergeJobId: merge.jobId,
      affectedRowCount: merge.affectedRowCount,
      reusedExistingJob: merge.reusedExistingJob,
    });
    respond(response, 204);
  } catch (error) {
    if (error instanceof InvalidPubSubEventError) {
      log('WARNING', {
        event: 'energy_processing_event_rejected',
        cloudEventId: error.cloudEventId,
        reason: error.message,
      });
      // Malformed event data is not transient. Acknowledge it.
      respond(response, 204);
      return;
    }

    log('ERROR', {
      event: 'energy_processing_failed',
      reason: error instanceof Error ? error.message : String(error),
    });
    // Technical failures are retryable, so do not acknowledge the event.
    respond(response, 500, {error: 'Energy processing failed'});
  }
}
