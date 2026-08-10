import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import type {Firestore, Transaction} from '@google-cloud/firestore';
import {FirestoreImportRunStore} from '../src/import-run-store.ts';

describe('FirestoreImportRunStore', () => {
  it('changes a STAGED import to COMPLETED', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const store = new FirestoreImportRunStore(
      fakeFirestore({status: 'STAGED', stagedEventId: 'event-1'}, updates),
    );

    const result = await store.markCompleted(
      'import-1',
      'event-1',
      'merge-job-1',
    );

    assert.equal(result, 'completed');
    assert.equal(updates.length, 1);
    assert.equal(updates[0]?.status, 'COMPLETED');
    assert.equal(updates[0]?.mergeJobId, 'merge-job-1');
    assert.equal(updates[0]?.mergeJobStatus, 'SUCCEEDED');
    assert.equal(updates[0]?.processedStagedEventId, 'event-1');
    assert.equal(updates[0]?.stagedEventId, 'event-1');
    assert.ok(updates[0]?.stagedEventPublishedAt != null);
  });

  it('treats an already COMPLETED import as a successful retry', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const store = new FirestoreImportRunStore(
      fakeFirestore({status: 'COMPLETED'}, updates),
    );

    const result = await store.markCompleted(
      'import-1',
      'event-1',
      'merge-job-1',
    );

    assert.equal(result, 'already-completed');
    assert.deepEqual(updates, []);
  });
});

function fakeFirestore(
  data: Record<string, unknown>,
  updates: Array<Record<string, unknown>>,
): Firestore {
  const reference = {path: 'importRuns/import-1'};
  return {
    collection: () => ({doc: () => reference}),
    runTransaction: async (
      callback: (transaction: Transaction) => Promise<unknown>,
    ) => {
      const transaction = {
        get: async () => ({data: () => data}),
        update: (_reference: unknown, update: Record<string, unknown>) => {
          updates.push(update);
        },
      } as unknown as Transaction;
      return callback(transaction);
    },
  } as unknown as Firestore;
}
