import {BigQuery} from '@google-cloud/bigquery';

interface EnergyRecordQueryOptions {
  query: string;
  params: {importId: string};
  location?: string;
}

export interface EnergyRecord {
  recordId: string;
  meterId: string;
  periodStart: string;
  consumptionKwh: string;
  totalCostSek: string;
}

interface EnergyRecordRow {
  record_id?: unknown;
  meter_id?: unknown;
  period_start?: unknown;
  consumption_kwh?: unknown;
  total_cost_sek?: unknown;
}

type QueryRows = (
  options: EnergyRecordQueryOptions,
) => Promise<EnergyRecordRow[]>;

export interface EnergyRecordReader {
  findByImportId(importId: string): Promise<EnergyRecord[]>;
}

export class BigQueryEnergyRecordReader implements EnergyRecordReader {
  private readonly datasetId: string;
  private readonly location?: string;
  private readonly queryRows: QueryRows;

  constructor(
    datasetId: string,
    location?: string,
    queryRows: QueryRows = defaultQueryRows,
  ) {
    this.datasetId = datasetId;
    this.location = location;
    this.queryRows = queryRows;
  }

  async findByImportId(importId: string): Promise<EnergyRecord[]> {
    const rows = await this.queryRows({
      query: `
        SELECT
          record_id,
          meter_id,
          CAST(period_start AS STRING) AS period_start,
          CAST(consumption_kwh AS STRING) AS consumption_kwh,
          CAST(total_cost_sek AS STRING) AS total_cost_sek
        FROM \`${this.datasetId}.energy_records\`
        WHERE source_import_id = @importId
        ORDER BY meter_id, period_start
      `,
      params: {importId},
      location: this.location,
    });

    return rows.map(row => ({
      recordId: requiredString(row.record_id, 'record_id'),
      meterId: requiredString(row.meter_id, 'meter_id'),
      periodStart: requiredString(row.period_start, 'period_start'),
      consumptionKwh: requiredString(row.consumption_kwh, 'consumption_kwh'),
      totalCostSek: requiredString(row.total_cost_sek, 'total_cost_sek'),
    }));
  }
}

async function defaultQueryRows(
  options: EnergyRecordQueryOptions,
): Promise<EnergyRecordRow[]> {
  const [rows] = await new BigQuery().query(options);
  return rows as EnergyRecordRow[];
}

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`BigQuery returned an invalid ${fieldName}`);
  }
  return value;
}
