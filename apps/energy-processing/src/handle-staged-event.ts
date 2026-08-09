import type {IncomingMessage, ServerResponse} from 'node:http';
import {respond} from './http.ts';
import {log} from './logging.ts';
import {
  InvalidPubSubEventError,
  parsePubSubEvent,
} from './parse-pubsub-event.ts';

export async function handleStagedEvent(
  request: IncomingMessage,
  response: ServerResponse,
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
    respond(response, 204);
  } catch (error) {
    log('WARNING', {
      event: 'energy_processing_event_rejected',
      cloudEventId:
        error instanceof InvalidPubSubEventError
          ? error.cloudEventId
          : undefined,
      reason: error instanceof Error ? error.message : String(error),
    });
    // Malformed event data is not transient. Acknowledge it.
    respond(response, 204);
  }
}
