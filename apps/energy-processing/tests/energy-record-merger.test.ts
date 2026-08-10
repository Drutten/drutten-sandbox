import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  BigQueryEnergyRecordMerger,
  createMergeJobId,
} from '../src/energy-record-merger.ts';

describe('BigQueryEnergyRecordMerger', () => {
  it('merges only the current import using record_id as the key', async () => {
    const calls: unknown[] = [];
    const merger = new BigQueryEnergyRecordMerger(
      'energy',
      'europe-west1',
      async options => {
        calls.push(options);
        return {affectedRowCount: '6', reusedExistingJob: false};
      },
    );

    const result = await merger.mergeImport('import-1', 'staged-event-1');

    assert.equal(result.jobId, createMergeJobId('staged-event-1'));
    assert.equal(result.affectedRowCount, 6);
    assert.equal(result.reusedExistingJob, false);
    const call = calls[0] as Record<string, unknown>;
    assert.deepEqual(call.params, {importId: 'import-1'});
    assert.equal(call.location, 'europe-west1');
    assert.equal(call.useLegacySql, false);
    assert.match(String(call.query), /ON target\.record_id = source\.record_id/);
    assert.match(
      String(call.query),
      /WHERE source_import_id = @importId/,
    );
    assert.match(String(call.query), /PARTITION BY record_id/);
    assert.match(String(call.query), /WHEN MATCHED THEN/);
    assert.match(String(call.query), /WHEN NOT MATCHED THEN/);
  });

  it('uses the same job ID for repeated delivery of the same staged event', () => {
    assert.equal(
      createMergeJobId('staged-event-1'),
      createMergeJobId('staged-event-1'),
    );
    assert.notEqual(
      createMergeJobId('staged-event-1'),
      createMergeJobId('staged-event-2'),
    );
  });
});
