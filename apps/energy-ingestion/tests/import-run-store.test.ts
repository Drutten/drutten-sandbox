import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  Timestamp,
  type DocumentData,
  type Firestore,
} from '@google-cloud/firestore';
import { ImportRunStore } from '../src/import-run-store.ts';

const identity = {
  importId: 'abc123',
  eventId: 'event-1',
  bucketName: 'uploads',
  objectName: 'energy.csv',
  objectGeneration: '123',
  sizeBytes: 100,
};

describe('ImportRunStore.claim', () => {
  it('creates the first processing attempt', async () => {
    const fake = fakeFirestore();
    const result = await new ImportRunStore(fake.firestore).claim(
      identity,
      'owner-1',
    );

    assert.equal(result.kind, 'claimed');
    if (result.kind !== 'claimed') return;
    assert.equal(result.attemptNumber, 1);
    assert.equal(result.stagingJobId, 'energy-staging-abc123-1');
    assert.equal(
      result.validationErrorsJobId,
      'energy-validation-errors-abc123-1',
    );
    assert.equal(fake.writtenData?.status, 'PROCESSING');
  });

  it('does not claim an import with an active lease', async () => {
    const fake = fakeFirestore({
      status: 'PROCESSING',
      leaseExpiresAt: Timestamp.fromMillis(Date.now() + 60_000),
    });
    const result = await new ImportRunStore(fake.firestore).claim(
      identity,
      'owner-2',
    );

    assert.deepEqual(result, { kind: 'in-progress' });
    assert.equal(fake.writtenData, undefined);
  });

  it('retains a successful job and replaces only a failed job', async () => {
    const fake = fakeFirestore({
      status: 'FAILED_TECHNICAL',
      attemptNumber: 1,
      stagingJobId: 'energy-staging-abc123-1',
      stagingJobStatus: 'SUCCEEDED',
      validationErrorsJobId: 'energy-validation-errors-abc123-1',
      validationErrorsJobStatus: 'FAILED',
    });
    const result = await new ImportRunStore(fake.firestore).claim(
      identity,
      'owner-2',
    );

    assert.equal(result.kind, 'claimed');
    if (result.kind !== 'claimed') return;
    assert.equal(result.attemptNumber, 2);
    assert.equal(result.stagingJobId, 'energy-staging-abc123-1');
    assert.equal(
      result.validationErrorsJobId,
      'energy-validation-errors-abc123-2',
    );
  });
});

describe('ImportRunStore.markStagedEventPublished', () => {
  it('accepts that processing already completed the import', async () => {
    const fake = fakeFirestore({ status: 'COMPLETED' });

    await new ImportRunStore(fake.firestore).markStagedEventPublished(
      identity.importId,
      'staged-event-1',
    );

    assert.equal(fake.writtenData?.stagedEventId, 'staged-event-1');
    assert.ok(fake.writtenData?.stagedEventPublishedAt != null);
  });
});

function fakeFirestore(existing?: DocumentData): {
  firestore: Firestore;
  writtenData?: DocumentData;
} {
  const result: {
    firestore: Firestore;
    writtenData?: DocumentData;
  } = {} as {
    firestore: Firestore;
    writtenData?: DocumentData;
  };
  interface FakeTransaction {
    get(): Promise<{ data: () => DocumentData | undefined }>;
    set(reference: unknown, data: DocumentData): void;
    update(reference: unknown, data: DocumentData): void;
  }
  const reference = {};
  const transaction: FakeTransaction = {
    async get() {
      return { data: () => existing };
    },
    set(_reference: unknown, data: DocumentData) {
      result.writtenData = data;
    },
    update(_reference: unknown, data: DocumentData) {
      result.writtenData = data;
    },
  };
  result.firestore = {
    collection() {
      return {
        doc() {
          return reference;
        },
      };
    },
    async runTransaction<T>(
      callback: (transaction: FakeTransaction) => Promise<T>,
    ): Promise<T> {
      return callback(transaction);
    },
  } as unknown as Firestore;
  return result;
}
