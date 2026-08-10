import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import type {PubSub} from '@google-cloud/pubsub';
import {
  createEnergyImportCompletedEvent,
  EnergyEventPublisher,
} from '../src/energy-events.ts';

const data = {
  importId: 'import-123',
  stagedEventId: 'staged-event-123',
  mergeJobId: 'merge-job-123',
  bucketName: 'energy-uploads',
  objectName: 'energy.csv',
  objectGeneration: '42',
  rowCount: 6,
  validRowCount: 5,
  invalidRowCount: 1,
};

describe('createEnergyImportCompletedEvent', () => {
  it('creates the same event ID for retries of the same import', () => {
    const first = createEnergyImportCompletedEvent(
      data,
      '2026-08-10T10:00:00Z',
    );
    const retry = createEnergyImportCompletedEvent(
      data,
      '2026-08-10T10:01:00Z',
    );

    assert.equal(first.eventId, retry.eventId);
    assert.equal(first.eventType, 'EnergyImportCompleted');
  });

  it('creates a different event ID for a different import', () => {
    const first = createEnergyImportCompletedEvent(data);
    const second = createEnergyImportCompletedEvent({
      ...data,
      importId: 'import-456',
    });

    assert.notEqual(first.eventId, second.eventId);
  });

  it('publishes the event and its identity attributes to the completed topic', async () => {
    const published: Array<Record<string, unknown>> = [];
    const pubsub = {
      topic: (topicId: string) => ({
        publishMessage: async (message: Record<string, unknown>) => {
          published.push({topicId, ...message});
          return 'message-1';
        },
      }),
    } as unknown as PubSub;

    const result = await new EnergyEventPublisher(
      pubsub,
      'energy-import-completed',
    ).publishImportCompleted(data);

    assert.equal(result.messageId, 'message-1');
    assert.equal(published[0]?.topicId, 'energy-import-completed');
    assert.deepEqual(published[0]?.attributes, {
      eventId: result.event.eventId,
      eventType: 'EnergyImportCompleted',
    });
    assert.deepEqual(published[0]?.json, result.event);
  });
});
