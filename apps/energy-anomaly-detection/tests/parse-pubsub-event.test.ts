import assert from 'node:assert/strict';
import type {IncomingMessage} from 'node:http';
import {Readable} from 'node:stream';
import {describe, it} from 'node:test';
import {
  InvalidPubSubEventError,
  parsePubSubEvent,
} from '../src/parse-pubsub-event.ts';

const completedEvent = {
  eventId: 'completed-event-1',
  eventType: 'EnergyImportCompleted',
  occurredAt: '2026-08-15T20:00:00.000Z',
  importId: 'import-1',
  stagedEventId: 'staged-event-1',
  mergeJobId: 'merge-job-1',
  bucketName: 'energy-uploads',
  objectName: 'energy.csv',
  objectGeneration: '42',
  rowCount: 6,
  validRowCount: 5,
  invalidRowCount: 1,
};

describe('parsePubSubEvent', () => {
  it('decodes an EnergyImportCompleted event from the Eventarc envelope', async () => {
    const delivery = await parsePubSubEvent(pubsubRequest(completedEvent));

    assert.equal(delivery.cloudEventId, 'message-1');
    assert.equal(delivery.pubsubMessageId, 'message-1');
    assert.equal(delivery.event.eventId, 'completed-event-1');
    assert.equal(delivery.event.importId, 'import-1');
    assert.equal(delivery.event.validRowCount, 5);
  });

  it('rejects an unsupported domain event', async () => {
    const request = pubsubRequest({...completedEvent, eventType: 'OtherEvent'});

    await assert.rejects(parsePubSubEvent(request), (error: unknown) => {
      assert.ok(error instanceof InvalidPubSubEventError);
      assert.match(error.message, /Unsupported domain event type/);
      return true;
    });
  });

  it('rejects when the event ID attribute and payload disagree', async () => {
    const request = pubsubRequest(completedEvent, {
      eventId: 'different-event',
      eventType: 'EnergyImportCompleted',
    });

    await assert.rejects(parsePubSubEvent(request), (error: unknown) => {
      assert.ok(error instanceof InvalidPubSubEventError);
      assert.match(error.message, /does not match/);
      return true;
    });
  });
});

function pubsubRequest(
  event: Record<string, unknown>,
  attributes: Record<string, string> = {
    eventId: 'completed-event-1',
    eventType: 'EnergyImportCompleted',
  },
): IncomingMessage {
  const body = {
    message: {
      data: Buffer.from(JSON.stringify(event)).toString('base64'),
      attributes,
      messageId: 'message-1',
      publishTime: '2026-08-15T20:00:01.000Z',
    },
  };
  const request = Readable.from([JSON.stringify(body)]) as IncomingMessage;
  request.headers = {
    'ce-id': 'message-1',
    'ce-type': 'google.cloud.pubsub.topic.v1.messagePublished',
  };
  return request;
}
