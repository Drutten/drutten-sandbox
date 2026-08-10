import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {BigQueryStagingRecordReader} from '../src/staging-records.ts';

describe('BigQueryStagingRecordReader', () => {
  it('counts only staging rows belonging to the import', async () => {
    const calls: unknown[] = [];
    const queryRows = async (
      options: unknown,
    ): Promise<Array<{row_count: string}>> => {
      calls.push(options);
      return [{row_count: '6'}];
    };
    const reader = new BigQueryStagingRecordReader(
      'energy',
      'europe-west1',
      queryRows,
    );

    assert.equal(await reader.countByImportId('import-1'), 6);
    assert.deepEqual(calls, [
      {
        query: `
        SELECT COUNT(*) AS row_count
        FROM \`energy.energy_records_staging\`
        WHERE source_import_id = @importId
      `,
        params: {importId: 'import-1'},
        location: 'europe-west1',
      },
    ]);
  });
});
