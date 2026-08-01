import type {BigQuery} from '@google-cloud/bigquery';
import type {Storage} from '@google-cloud/storage';
import {
  BatchedBigQueryLoader,
  stagingSchema,
  toStagingRow,
  toValidationErrorRows,
  validationErrorsSchema,
} from './bigquery-loaders.ts';
import type {ClaimedImport, ImportRunStore} from './import-run-store.ts';
import {parseCsvRows, type CsvValidationSummary} from './parse-csv-rows.ts';
import type {StorageFinalizedEvent} from './parse-storage-event.ts';

export interface StageCsvFileDependencies {
  storage: Storage;
  bigquery: BigQuery;
  importRunStore: ImportRunStore;
  region: string;
  energyDatasetId: string;
}

export async function stageCsvFile(
  event: StorageFinalizedEvent,
  claim: ClaimedImport,
  dependencies: StageCsvFileDependencies,
): Promise<CsvValidationSummary> {
  const dataset = dependencies.bigquery.dataset(dependencies.energyDatasetId, {
    location: dependencies.region,
  });
  const stagingLoader = new BatchedBigQueryLoader(
    dependencies.bigquery,
    dataset.table('energy_records_staging'),
    dependencies.region,
    'staging',
    claim.stagingJobId,
    stagingSchema,
    claim.stagingAlreadySucceeded,
  );
  const validationErrorsLoader = new BatchedBigQueryLoader(
    dependencies.bigquery,
    dataset.table('validation_errors'),
    dependencies.region,
    'validationErrors',
    claim.validationErrorsJobId,
    validationErrorsSchema,
    claim.validationErrorsAlreadySucceeded,
  );

  try {
    const processingTimestamp = new Date().toISOString();
    const contents = dependencies.storage
      .bucket(event.bucketName)
      .file(event.objectName, {generation: event.objectGeneration})
      .createReadStream();
    const summary = await parseCsvRows(contents, {
      onValidRow: async (row, rowNumber, recordId) => {
        await stagingLoader.addRow(
          toStagingRow(
            row,
            rowNumber,
            recordId,
            event.importId,
            processingTimestamp,
          ),
        );
      },
      onInvalidRow: async (invalidRow, parsedRow) => {
        for (const errorRow of toValidationErrorRows(
          invalidRow,
          parsedRow,
          event.importId,
          processingTimestamp,
        )) {
          await validationErrorsLoader.addRow(errorRow);
        }
      },
    });

    await stagingLoader.finalize();
    await dependencies.importRunStore.markOutputSucceeded(
      event.importId,
      claim.ownerId,
      'staging',
    );
    await validationErrorsLoader.finalize();
    await dependencies.importRunStore.markOutputSucceeded(
      event.importId,
      claim.ownerId,
      'validationErrors',
    );
    return summary;
  } catch (error) {
    const caughtError =
      error instanceof Error ? error : new Error(String(error));
    stagingLoader.abort(caughtError);
    validationErrorsLoader.abort(caughtError);
    throw error;
  }
}
