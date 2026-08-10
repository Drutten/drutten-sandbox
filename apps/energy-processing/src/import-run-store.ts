import {Firestore, Timestamp} from '@google-cloud/firestore';

export type CompleteImportResult = 'completed' | 'already-completed';

export interface ImportRunCompleter {
  markCompleted(
    importId: string,
    stagedEventId: string,
    mergeJobId: string,
  ): Promise<CompleteImportResult>;
}

const collectionName = 'importRuns';

export class FirestoreImportRunStore implements ImportRunCompleter {
  private readonly firestore: Firestore;

  constructor(firestore: Firestore) {
    this.firestore = firestore;
  }

  async markCompleted(
    importId: string,
    stagedEventId: string,
    mergeJobId: string,
  ): Promise<CompleteImportResult> {
    const reference = this.firestore.collection(collectionName).doc(importId);

    return this.firestore.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference);
      const data = snapshot.data();
      if (!data) {
        throw new Error(`Import run ${importId} does not exist`);
      }
      if (data.status === 'COMPLETED') {
        return 'already-completed';
      }
      if (data.status !== 'STAGED') {
        throw new Error(
          `Cannot complete import ${importId} from status ${String(data.status)}`,
        );
      }
      if (data.stagedEventId != null && data.stagedEventId !== stagedEventId) {
        throw new Error(`Staged event does not match import ${importId}`);
      }

      const now = Timestamp.now();
      transaction.update(reference, {
        status: 'COMPLETED',
        mergeJobId,
        mergeJobStatus: 'SUCCEEDED',
        processedStagedEventId: stagedEventId,
        ...(data.stagedEventPublishedAt == null
          ? {stagedEventId, stagedEventPublishedAt: now}
          : {}),
        completedAt: now,
        technicalError: null,
        updatedAt: now,
      });
      return 'completed';
    });
  }
}
