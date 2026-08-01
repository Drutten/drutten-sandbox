import {
  Firestore,
  Timestamp,
  type DocumentData,
  type Transaction,
} from '@google-cloud/firestore';
import type {LoadOutput} from './bigquery-loaders.ts';

export interface ImportIdentity {
  importId: string;
  eventId: string;
  bucketName: string;
  objectName: string;
  objectGeneration: string;
  sizeBytes: number;
}

export interface ClaimedImport {
  kind: 'claimed';
  ownerId: string;
  attemptNumber: number;
  stagingJobId: string;
  validationErrorsJobId: string;
  stagingAlreadySucceeded: boolean;
  validationErrorsAlreadySucceeded: boolean;
}

export type ClaimImportResult =
  | ClaimedImport
  | {
      kind: 'already-finished';
      status: string;
      stagedEventPublished: boolean;
      rowCount: number;
      validRowCount: number;
      invalidRowCount: number;
    }
  | {kind: 'in-progress'};

const collectionName = 'importRuns';
const leaseDurationMilliseconds = 10 * 60 * 1000;
const terminalStatuses = new Set(['STAGED', 'COMPLETED', 'REJECTED_DATA']);

export class ImportRunStore {
  private readonly firestore: Firestore;

  constructor(firestore: Firestore) {
    this.firestore = firestore;
  }

  async claim(
    identity: ImportIdentity,
    ownerId: string,
  ): Promise<ClaimImportResult> {
    const reference = this.firestore
      .collection(collectionName)
      .doc(identity.importId);

    return this.firestore.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference);
      const existing = snapshot.data();
      const now = Timestamp.now();

      if (existing && terminalStatuses.has(String(existing.status))) {
        return {
          kind: 'already-finished',
          status: String(existing.status),
          stagedEventPublished: existing.stagedEventPublishedAt != null,
          rowCount: numberValue(existing.rowCount),
          validRowCount: numberValue(existing.validRowCount),
          invalidRowCount: numberValue(existing.invalidRowCount),
        };
      }

      if (isActivelyProcessing(existing, now)) {
        return {kind: 'in-progress'};
      }

      const previousAttempt = numberValue(existing?.attemptNumber);
      const isNewAttempt = existing?.status === 'FAILED_TECHNICAL';
      const attemptNumber =
        previousAttempt === 0
          ? 1
          : isNewAttempt
            ? previousAttempt + 1
            : previousAttempt;
      const stagingAlreadySucceeded =
        existing?.stagingJobStatus === 'SUCCEEDED';
      const validationErrorsAlreadySucceeded =
        existing?.validationErrorsJobStatus === 'SUCCEEDED';
      const stagingJobId = outputJobId(
        existing,
        'stagingJobId',
        'stagingJobStatus',
        'energy-staging',
        identity.importId,
        attemptNumber,
      );
      const validationErrorsJobId = outputJobId(
        existing,
        'validationErrorsJobId',
        'validationErrorsJobStatus',
        'energy-validation-errors',
        identity.importId,
        attemptNumber,
      );

      transaction.set(
        reference,
        {
          importId: identity.importId,
          eventId: identity.eventId,
          bucketName: identity.bucketName,
          objectName: identity.objectName,
          objectGeneration: identity.objectGeneration,
          sizeBytes: identity.sizeBytes,
          status: 'PROCESSING',
          attemptNumber,
          ownerId,
          leaseExpiresAt: Timestamp.fromMillis(
            now.toMillis() + leaseDurationMilliseconds,
          ),
          stagingJobId,
          stagingJobStatus: stagingAlreadySucceeded ? 'SUCCEEDED' : 'PENDING',
          validationErrorsJobId,
          validationErrorsJobStatus: validationErrorsAlreadySucceeded
            ? 'SUCCEEDED'
            : 'PENDING',
          technicalError: null,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        },
        {merge: true},
      );

      return {
        kind: 'claimed',
        ownerId,
        attemptNumber,
        stagingJobId,
        validationErrorsJobId,
        stagingAlreadySucceeded,
        validationErrorsAlreadySucceeded,
      };
    });
  }

  async markOutputSucceeded(
    importId: string,
    ownerId: string,
    output: LoadOutput,
  ): Promise<void> {
    await this.updateOwnedRun(importId, ownerId, (transaction, _data, now) => {
      transaction.update(this.document(importId), {
        [outputStatusField(output)]: 'SUCCEEDED',
        updatedAt: now,
      });
    });
  }

  async markStaged(
    importId: string,
    ownerId: string,
    summary: {
      rowCount: number;
      validRowCount: number;
      invalidRowCount: number;
    },
  ): Promise<void> {
    await this.updateOwnedRun(importId, ownerId, (transaction, data, now) => {
      if (
        data.stagingJobStatus !== 'SUCCEEDED' ||
        data.validationErrorsJobStatus !== 'SUCCEEDED'
      ) {
        throw new Error(
          'Cannot mark import STAGED before both outputs succeed',
        );
      }

      transaction.update(this.document(importId), {
        status: 'STAGED',
        ...summary,
        leaseExpiresAt: now,
        updatedAt: now,
      });
    });
  }

  async markTechnicalFailure(
    importId: string,
    ownerId: string,
    technicalError: string,
    failedOutput?: LoadOutput,
  ): Promise<void> {
    await this.updateOwnedRun(importId, ownerId, (transaction, _data, now) => {
      transaction.update(this.document(importId), {
        status: 'FAILED_TECHNICAL',
        ...(failedOutput ? {[outputStatusField(failedOutput)]: 'FAILED'} : {}),
        technicalError,
        leaseExpiresAt: now,
        updatedAt: now,
      });
    });
  }

  async markStagedEventPublished(
    importId: string,
    eventId: string,
  ): Promise<void> {
    const reference = this.document(importId);
    await this.firestore.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference);
      const data = snapshot.data();
      if (!data || data.status !== 'STAGED') {
        throw new Error('Cannot mark staged event for a non-STAGED import');
      }
      if (data.stagedEventPublishedAt != null) return;

      const now = Timestamp.now();
      transaction.update(reference, {
        stagedEventId: eventId,
        stagedEventPublishedAt: now,
        updatedAt: now,
      });
    });
  }

  async markRejected(
    identity: ImportIdentity,
    reason: string,
    details?: string,
    ownerId?: string,
  ): Promise<void> {
    const reference = this.document(identity.importId);
    await this.firestore.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference);
      const existing = snapshot.data();
      if (existing && terminalStatuses.has(String(existing.status))) return;
      if (ownerId && existing?.ownerId !== ownerId) {
        throw new Error('Import processing lease is no longer owned');
      }

      const now = Timestamp.now();
      transaction.set(
        reference,
        {
          importId: identity.importId,
          eventId: identity.eventId,
          bucketName: identity.bucketName,
          objectName: identity.objectName,
          objectGeneration: identity.objectGeneration,
          sizeBytes: identity.sizeBytes,
          status: 'REJECTED_DATA',
          rejectionReason: reason,
          rejectionDetails: details ?? null,
          leaseExpiresAt: now,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        },
        {merge: true},
      );
    });
  }

  private document(importId: string) {
    return this.firestore.collection(collectionName).doc(importId);
  }

  private async updateOwnedRun(
    importId: string,
    ownerId: string,
    update: (
      transaction: Transaction,
      data: DocumentData,
      now: Timestamp,
    ) => void,
  ): Promise<void> {
    const reference = this.document(importId);
    await this.firestore.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference);
      const data = snapshot.data();
      if (!data || data.status !== 'PROCESSING' || data.ownerId !== ownerId) {
        throw new Error('Import processing lease is no longer owned');
      }
      update(transaction, data, Timestamp.now());
    });
  }
}

function isActivelyProcessing(
  existing: DocumentData | undefined,
  now: Timestamp,
): boolean {
  return (
    existing?.status === 'PROCESSING' &&
    existing.leaseExpiresAt instanceof Timestamp &&
    existing.leaseExpiresAt.toMillis() > now.toMillis()
  );
}

function outputStatusField(
  output: LoadOutput,
): 'stagingJobStatus' | 'validationErrorsJobStatus' {
  return output === 'staging'
    ? 'stagingJobStatus'
    : 'validationErrorsJobStatus';
}

function createJobId(
  prefix: string,
  importId: string,
  attemptNumber: number,
): string {
  return `${prefix}-${importId}-${attemptNumber}`;
}

function outputJobId(
  existing: DocumentData | undefined,
  jobIdField: string,
  statusField: string,
  prefix: string,
  importId: string,
  attemptNumber: number,
): string {
  const existingJobId = existing?.[jobIdField];
  const shouldReplace = existing?.[statusField] === 'FAILED';
  if (typeof existingJobId === 'string' && !shouldReplace) {
    return existingJobId;
  }
  return createJobId(prefix, importId, attemptNumber);
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : 0;
}
