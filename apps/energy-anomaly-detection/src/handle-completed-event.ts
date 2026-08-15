import type {IncomingMessage, ServerResponse} from 'node:http';
import {respond} from './http.ts';
import {log} from './logging.ts';
import {
  InvalidPubSubEventError,
  parsePubSubEvent,
} from './parse-pubsub-event.ts';

export async function handleCompletedEvent(
  request: IncomingMessage,
  response: ServerResponse,
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
