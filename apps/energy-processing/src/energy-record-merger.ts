import {createHash} from 'node:crypto';
import {BigQuery} from '@google-cloud/bigquery';

interface MergeQueryOptions {
  query: string;
  params: {importId: string};
  jobId: string;
  location?: string;
  useLegacySql: false;
}

interface MergeJobResult {
  affectedRowCount?: number | string;
  reusedExistingJob: boolean;
}

type RunMergeJob = (options: MergeQueryOptions) => Promise<MergeJobResult>;

export interface MergeResult {
  jobId: string;
  affectedRowCount?: number;
  reusedExistingJob: boolean;
}

export interface EnergyRecordMerger {
  mergeImport(importId: string, stagedEventId: string): Promise<MergeResult>;
}

export class BigQueryEnergyRecordMerger implements EnergyRecordMerger {
  private readonly datasetId: string;
  private readonly location?: string;
  private readonly runMergeJob: RunMergeJob;

  constructor(
    datasetId: string,
    location?: string,
    runMergeJob: RunMergeJob = defaultRunMergeJob,
  ) {
    this.datasetId = datasetId;
    this.location = location;
    this.runMergeJob = runMergeJob;
  }

  async mergeImport(
    importId: string,
    stagedEventId: string,
  ): Promise<MergeResult> {
    const jobId = createMergeJobId(stagedEventId);
    const result = await this.runMergeJob({
      query: mergeSql(this.datasetId),
      params: {importId},
      jobId,
      location: this.location,
      useLegacySql: false,
    });

    const affectedRowCount = parseOptionalCount(result.affectedRowCount);
    return {
      jobId,
      affectedRowCount,
      reusedExistingJob: result.reusedExistingJob,
    };
  }
}

export function createMergeJobId(stagedEventId: string): string {
  const digest = createHash('sha256').update(stagedEventId).digest('hex');
  return `energy_merge_${digest}`;
}

function mergeSql(datasetId: string): string {
  return `
    MERGE \`${datasetId}.energy_records\` AS target
    USING (
      SELECT *
      FROM \`${datasetId}.energy_records_staging\`
      WHERE source_import_id = @importId
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY record_id ORDER BY source_row_number DESC
      ) = 1
    ) AS source
    ON target.record_id = source.record_id
    WHEN MATCHED THEN
      UPDATE SET
        meter_id = source.meter_id,
        period_start = source.period_start,
        period_end = source.period_end,
        reading_start_kwh = source.reading_start_kwh,
        reading_end_kwh = source.reading_end_kwh,
        consumption_kwh = source.consumption_kwh,
        estimated_annual_kwh = source.estimated_annual_kwh,
        grid_area = source.grid_area,
        subscription_cost_sek = source.subscription_cost_sek,
        transmission_cost_sek = source.transmission_cost_sek,
        energy_tax_sek = source.energy_tax_sek,
        grid_vat_sek = source.grid_vat_sek,
        grid_total_sek = source.grid_total_sek,
        electricity_cost_sek = source.electricity_cost_sek,
        electricity_annual_fee_sek = source.electricity_annual_fee_sek,
        electricity_vat_sek = source.electricity_vat_sek,
        electricity_total_sek = source.electricity_total_sek,
        total_cost_sek = source.total_cost_sek,
        source_import_id = source.source_import_id,
        source_row_number = source.source_row_number,
        updated_at = CURRENT_TIMESTAMP()
    WHEN NOT MATCHED THEN
      INSERT (
        record_id, meter_id, period_start, period_end, reading_start_kwh,
        reading_end_kwh, consumption_kwh, estimated_annual_kwh, grid_area,
        subscription_cost_sek, transmission_cost_sek, energy_tax_sek,
        grid_vat_sek, grid_total_sek, electricity_cost_sek,
        electricity_annual_fee_sek, electricity_vat_sek,
        electricity_total_sek, total_cost_sek, source_import_id,
        source_row_number, created_at, updated_at
      )
      VALUES (
        source.record_id, source.meter_id, source.period_start,
        source.period_end, source.reading_start_kwh, source.reading_end_kwh,
        source.consumption_kwh, source.estimated_annual_kwh, source.grid_area,
        source.subscription_cost_sek, source.transmission_cost_sek,
        source.energy_tax_sek, source.grid_vat_sek, source.grid_total_sek,
        source.electricity_cost_sek, source.electricity_annual_fee_sek,
        source.electricity_vat_sek, source.electricity_total_sek,
        source.total_cost_sek, source.source_import_id,
        source.source_row_number, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()
      )
  `;
}

async function defaultRunMergeJob(
  options: MergeQueryOptions,
): Promise<MergeJobResult> {
  const client = new BigQuery();
  let job;
  let reusedExistingJob = false;

  try {
    [job] = await client.createQueryJob(options);
  } catch (error) {
    if (!isDuplicateJobError(error)) {
      throw error;
    }
    job = client.job(options.jobId, {location: options.location});
    reusedExistingJob = true;
  }

  await job.promise();
  const [metadata] = await job.getMetadata();
  return {
    affectedRowCount: metadata.statistics?.query?.numDmlAffectedRows,
    reusedExistingJob,
  };
}

function isDuplicateJobError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as {
    code?: unknown;
    errors?: Array<{reason?: unknown}>;
  };
  return (
    candidate.code === 409 ||
    candidate.errors?.some(({reason}) => reason === 'duplicate') === true
  );
}

function parseOptionalCount(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('BigQuery returned an invalid affected row count');
  }
  return count;
}
