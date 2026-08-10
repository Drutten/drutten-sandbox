import {Firestore, Timestamp} from '@google-cloud/firestore';

export interface CompleteImportResult {
  alreadyCompleted: boolean;
  completedEventPublished: boolean;
}

export interface ImportRunCompleter {
  markCompleted(
    importId: string,
    stagedEventId: string,
    mergeJobId: string,
  ): Promise<CompleteImportResult>;
  markCompletedEventPublished(importId: string, eventId: string): Promise<void>;
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
        return {
          alreadyCompleted: true,
          completedEventPublished: data.completedEventPublishedAt != null,
        };
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
      return {alreadyCompleted: false, completedEventPublished: false};
    });
  }

  async markCompletedEventPublished(
    importId: string,
    eventId: string,
  ): Promise<void> {
    const reference = this.firestore.collection(collectionName).doc(importId);

    await this.firestore.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference);
      const data = snapshot.data();
      if (!data || data.status !== 'COMPLETED') {
        throw new Error(
          `Cannot mark completed event for non-COMPLETED import ${importId}`,
        );
      }
      if (data.completedEventPublishedAt != null) {
        if (data.completedEventId !== eventId) {
          throw new Error(`Completed event does not match import ${importId}`);
        }
        return;
      }

      const now = Timestamp.now();
      transaction.update(reference, {
        completedEventId: eventId,
        completedEventPublishedAt: now,
        updatedAt: now,
      });
    });
  }
}
