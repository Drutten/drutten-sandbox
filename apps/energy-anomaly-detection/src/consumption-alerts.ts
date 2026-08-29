import {createHash} from 'node:crypto';
import {BigQuery} from '@google-cloud/bigquery';
import type {EnergyRecordAnalysis} from './analyze-energy-records.ts';

const CONSUMPTION_INCREASE_ALERT_TYPE = 'CONSUMPTION_INCREASE';

export interface ConsumptionAlert {
  alertId: string;
  recordId: string;
  meterId: string;
  periodStart: string;
  previousPeriodStart: string;
  consumptionKwh: string;
  previousConsumptionKwh: string;
  changePercent: number;
  reason: string;
  sourceImportId: string;
  sourceCompletedEventId: string;
}

interface MergeQueryOptions {
  query: string;
  params: {alertsJson: string};
  jobId: string;
  location?: string;
  useLegacySql: false;
}

interface MergeJobResult {
  affectedRowCount?: number | string;
  reusedExistingJob: boolean;
}

type RunMergeJob = (options: MergeQueryOptions) => Promise<MergeJobResult>;

export interface AlertMergeResult {
  jobId: string;
  affectedRowCount?: number;
  reusedExistingJob: boolean;
}

export interface ConsumptionAlertWriter {
  merge(
    alerts: ConsumptionAlert[],
    completedEventId: string,
  ): Promise<AlertMergeResult>;
}

export class BigQueryConsumptionAlertWriter implements ConsumptionAlertWriter {
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

  async merge(
    alerts: ConsumptionAlert[],
    completedEventId: string,
  ): Promise<AlertMergeResult> {
    const jobId = createAlertMergeJobId(completedEventId);
    const result = await this.runMergeJob({
      query: mergeSql(this.datasetId),
      params: {alertsJson: JSON.stringify(alerts)},
      jobId,
      location: this.location,
      useLegacySql: false,
    });

    return {
      jobId,
      affectedRowCount: parseOptionalCount(result.affectedRowCount),
      reusedExistingJob: result.reusedExistingJob,
    };
  }
}

export function createConsumptionAlert(
  importId: string,
  completedEventId: string,
  analysis: EnergyRecordAnalysis,
): ConsumptionAlert {
  const {record, result} = analysis;
  if (
    !result.isAnomaly ||
    result.changePercent === null ||
    record.previousPeriodStart === undefined ||
    record.previousConsumptionKwh === undefined
  ) {
    throw new Error('A consumption alert requires a comparable anomaly');
  }

  return {
    alertId: createAlertId(record.recordId),
    recordId: record.recordId,
    meterId: record.meterId,
    periodStart: record.periodStart,
    previousPeriodStart: record.previousPeriodStart,
    consumptionKwh: record.consumptionKwh,
    previousConsumptionKwh: record.previousConsumptionKwh,
    changePercent: result.changePercent,
    reason: result.reason,
    sourceImportId: importId,
    sourceCompletedEventId: completedEventId,
  };
}

export function createAlertId(recordId: string): string {
  return createHash('sha256')
    .update(`${CONSUMPTION_INCREASE_ALERT_TYPE}|${recordId}`)
    .digest('hex');
}

export function createAlertMergeJobId(completedEventId: string): string {
  const digest = createHash('sha256').update(completedEventId).digest('hex');
  return `energy_alert_merge_${digest}`;
}

function mergeSql(datasetId: string): string {
  return `
    MERGE \`${datasetId}.consumption_alerts\` AS target
    USING (
      SELECT
        JSON_VALUE(item, '$.alertId') AS alert_id,
        JSON_VALUE(item, '$.recordId') AS record_id,
        JSON_VALUE(item, '$.meterId') AS meter_id,
        CAST(JSON_VALUE(item, '$.periodStart') AS DATE) AS period_start,
        CAST(JSON_VALUE(item, '$.previousPeriodStart') AS DATE)
          AS previous_period_start,
        CAST(JSON_VALUE(item, '$.consumptionKwh') AS NUMERIC)
          AS consumption_kwh,
        CAST(JSON_VALUE(item, '$.previousConsumptionKwh') AS NUMERIC)
          AS previous_consumption_kwh,
        CAST(JSON_VALUE(item, '$.changePercent') AS NUMERIC)
          AS change_percent,
        JSON_VALUE(item, '$.reason') AS reason,
        JSON_VALUE(item, '$.sourceImportId') AS source_import_id,
        JSON_VALUE(item, '$.sourceCompletedEventId')
          AS source_completed_event_id
      FROM UNNEST(JSON_QUERY_ARRAY(@alertsJson)) AS item
    ) AS source
    ON target.alert_id = source.alert_id
    WHEN MATCHED THEN
      UPDATE SET
        record_id = source.record_id,
        meter_id = source.meter_id,
        period_start = source.period_start,
        previous_period_start = source.previous_period_start,
        consumption_kwh = source.consumption_kwh,
        previous_consumption_kwh = source.previous_consumption_kwh,
        change_percent = source.change_percent,
        reason = source.reason,
        source_import_id = source.source_import_id,
        source_completed_event_id = source.source_completed_event_id,
        updated_at = CURRENT_TIMESTAMP()
    WHEN NOT MATCHED THEN
      INSERT (
        alert_id, record_id, meter_id, period_start, previous_period_start,
        consumption_kwh, previous_consumption_kwh, change_percent, reason,
        source_import_id, source_completed_event_id, detected_at, updated_at
      )
      VALUES (
        source.alert_id, source.record_id, source.meter_id,
        source.period_start, source.previous_period_start,
        source.consumption_kwh, source.previous_consumption_kwh,
        source.change_percent, source.reason, source.source_import_id,
        source.source_completed_event_id, CURRENT_TIMESTAMP(),
        CURRENT_TIMESTAMP()
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
    if (!isDuplicateJobError(error)) throw error;
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

function parseOptionalCount(
  value: number | string | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('BigQuery returned an invalid affected row count');
  }
  return count;
}
