import {BigQuery} from '@google-cloud/bigquery';

interface CountQueryOptions {
  query: string;
  params: {importId: string};
  location?: string;
}

type QueryRows = (
  options: CountQueryOptions,
) => Promise<Array<{row_count?: number | string}>>;

export interface StagingRecordReader {
  countByImportId(importId: string): Promise<number>;
}

export class BigQueryStagingRecordReader implements StagingRecordReader {
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

  async countByImportId(importId: string): Promise<number> {
    const rows = await this.queryRows({
      query: `
        SELECT COUNT(*) AS row_count
        FROM \`${this.datasetId}.energy_records_staging\`
        WHERE source_import_id = @importId
      `,
      params: {importId},
      location: this.location,
    });

    const value = rows[0]?.row_count;
    const count = Number(value);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error('BigQuery returned an invalid staging row count');
    }
    return count;
  }
}

async function defaultQueryRows(
  options: CountQueryOptions,
): Promise<Array<{row_count?: number | string}>> {
  const [rows] = await new BigQuery().query(options);
  return rows as Array<{row_count?: number | string}>;
}
