import type {IncomingMessage, ServerResponse} from 'node:http';
import {analyzeEnergyRecords} from './analyze-energy-records.ts';
import {respond} from './http.ts';
import {log} from './logging.ts';
import {
  InvalidPubSubEventError,
  parsePubSubEvent,
} from './parse-pubsub-event.ts';
import type {EnergyRecordReader} from './energy-records.ts';

export interface CompletedEventDependencies {
  energyRecords: EnergyRecordReader;
}

export async function handleCompletedEvent(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: CompletedEventDependencies,
): Promise<void> {
  try {
    const delivery = await parsePubSubEvent(request);
    log('INFO', {
      event: 'energy_import_completed_received',
      cloudEventId: delivery.cloudEventId,
      pubsubMessageId: delivery.pubsubMessageId,
      completedEventId: delivery.event.eventId,
      importId: delivery.event.importId,
      rowCount: delivery.event.rowCount,
      validRowCount: delivery.event.validRowCount,
      invalidRowCount: delivery.event.invalidRowCount,
    });

    const records = await dependencies.energyRecords.findByImportId(
      delivery.event.importId,
    );
    const recordsWithPreviousPeriod = records.filter(
      record => record.previousRecordId !== undefined,
    ).length;
    log('INFO', {
      event: 'energy_anomaly_records_read',
      importId: delivery.event.importId,
      completedEventId: delivery.event.eventId,
      recordCount: records.length,
      expectedRecordCount: delivery.event.validRowCount,
      recordCountMatches: records.length === delivery.event.validRowCount,
      recordsWithPreviousPeriod,
      recordsWithoutPreviousPeriod: records.length - recordsWithPreviousPeriod,
    });

    const analyses = analyzeEnergyRecords(records);
    const anomalies = analyses.filter(analysis => analysis.result.isAnomaly);

    for (const {record, result} of anomalies) {
      log('WARNING', {
        event: 'energy_consumption_anomaly_detected',
        importId: delivery.event.importId,
        completedEventId: delivery.event.eventId,
        recordId: record.recordId,
        meterId: record.meterId,
        periodStart: record.periodStart,
        previousPeriodStart: record.previousPeriodStart,
        consumptionKwh: record.consumptionKwh,
        previousConsumptionKwh: record.previousConsumptionKwh,
        changePercent: result.changePercent,
        reason: result.reason,
      });
    }

    log('INFO', {
      event: 'energy_anomaly_analysis_completed',
      importId: delivery.event.importId,
      completedEventId: delivery.event.eventId,
      analyzedRecordCount: analyses.length,
      comparableRecordCount: analyses.filter(
        analysis => analysis.result.changePercent !== null,
      ).length,
      anomalyCount: anomalies.length,
    });

    respond(response, 204);
  } catch (error) {
    if (error instanceof InvalidPubSubEventError) {
      log('WARNING', {
        event: 'energy_anomaly_event_rejected',
        cloudEventId: error.cloudEventId,
        reason: error.message,
      });
      // Malformed event data is permanent, so acknowledge it.
      respond(response, 204);
      return;
    }

    log('ERROR', {
      event: 'energy_anomaly_detection_failed',
      reason: error instanceof Error ? error.message : String(error),
    });
    respond(response, 500, {error: 'Energy anomaly detection failed'});
  }
}
