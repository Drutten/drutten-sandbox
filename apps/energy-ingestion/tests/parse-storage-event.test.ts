import assert from 'node:assert/strict';
import type {IncomingMessage} from 'node:http';
import {Readable} from 'node:stream';
import {describe, it} from 'node:test';
import {createImportId} from '../src/identifiers.ts';
import {
  InvalidStorageEventError,
  parseStorageEvent,
} from '../src/parse-storage-event.ts';

describe('parseStorageEvent', () => {
  it('maps a finalized GCS CloudEvent to the import identity', async () => {
    const request = storageRequest({
      bucket: 'energy-uploads',
      name: 'energy.csv',
      generation: '42',
      size: '994',
    });

    const event = await parseStorageEvent(request);

    assert.equal(event.eventId, 'cloud-event-1');
    assert.equal(event.bucketName, 'energy-uploads');
    assert.equal(event.objectName, 'energy.csv');
    assert.equal(event.objectGeneration, '42');
    assert.equal(event.sizeBytes, 994);
    assert.equal(
      event.importId,
      createImportId('energy-uploads', 'energy.csv', '42'),
    );
  });

  it('rejects missing GCS metadata and retains the CloudEvent ID', async () => {
    const request = storageRequest({name: 'energy.csv'});

    await assert.rejects(parseStorageEvent(request), (error: unknown) => {
      assert.ok(error instanceof InvalidStorageEventError);
      assert.equal(error.eventId, 'cloud-event-1');
      assert.match(error.message, /bucket/);
      return true;
    });
  });
});

function storageRequest(body: Record<string, unknown>): IncomingMessage {
  const request = Readable.from([JSON.stringify(body)]) as IncomingMessage;
  request.headers = {
    'ce-id': 'cloud-event-1',
    'ce-type': 'google.cloud.storage.object.v1.finalized',
  };
  return request;
}
